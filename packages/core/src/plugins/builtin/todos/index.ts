import type { PluginContext } from '@mainframe/types';
import { nanoid } from 'nanoid';
import { z } from 'zod';

interface TodoRow {
  id: string;
  title: string;
  body: string;
  status: string;
  type: string;
  priority: string;
  labels: string;
  assignees: string;
  milestone: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

interface Todo extends Omit<TodoRow, 'labels' | 'assignees'> {
  labels: string[];
  assignees: string[];
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  type TEXT NOT NULL DEFAULT 'feature',
  priority TEXT NOT NULL DEFAULT 'medium',
  labels TEXT NOT NULL DEFAULT '[]',
  assignees TEXT NOT NULL DEFAULT '[]',
  milestone TEXT,
  order_index REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

const parseTodo = (r: TodoRow): Todo => ({
  ...r,
  labels: JSON.parse(r.labels) as string[],
  assignees: JSON.parse(r.assignees) as string[],
});

const TodoSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(''),
  status: z.enum(['open', 'in_progress', 'done']).default('open'),
  type: z
    .enum(['bug', 'feature', 'enhancement', 'documentation', 'question', 'wont_fix', 'duplicate', 'invalid'])
    .default('feature'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  labels: z.array(z.string()).default([]),
  assignees: z.array(z.string()).default([]),
  milestone: z.string().optional(),
});

function buildInitialMessage(todo: Todo): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const labels = todo.labels.length > 0 ? todo.labels.join(', ') : 'none';
  const lines = [
    `I'm working on this task from the kanban board:`,
    ``,
    `**${todo.title}**`,
    `Type: ${cap(todo.type)} | Priority: ${cap(todo.priority)} | Labels: ${labels}`,
  ];
  if (todo.milestone) lines.push(`Milestone: ${todo.milestone}`);
  if (todo.body) lines.push(``, `## Description`, todo.body);
  return lines.join('\n');
}

function registerTodoRoutes(ctx: PluginContext): void {
  const r = ctx.router;

  r.get('/todos', (_req, res) => {
    const rows = ctx.db.prepare<TodoRow>('SELECT * FROM todos ORDER BY status, order_index, created_at').all();
    res.json({ todos: rows.map(parseTodo) });
  });

  r.post('/todos', (req, res) => {
    const parsed = TodoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }
    const d = parsed.data;
    const now = new Date().toISOString();
    const id = nanoid();
    ctx.db
      .prepare(
        `INSERT INTO todos (id,title,body,status,type,priority,labels,assignees,milestone,order_index,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        d.title,
        d.body,
        d.status,
        d.type,
        d.priority,
        JSON.stringify(d.labels),
        JSON.stringify(d.assignees),
        d.milestone ?? null,
        0,
        now,
        now,
      );
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id)!;
    res.status(201).json({ todo: parseTodo(row) });
  });

  r.patch('/todos/:id', (req, res) => {
    const { id } = req.params;
    if (!ctx.db.prepare<{ id: string }>('SELECT id FROM todos WHERE id = ?').get(id)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const parsed = TodoSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }
    const d = parsed.data;
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];
    if (d.title !== undefined) {
      sets.push('title = ?');
      vals.push(d.title);
    }
    if (d.body !== undefined) {
      sets.push('body = ?');
      vals.push(d.body);
    }
    if (d.status !== undefined) {
      sets.push('status = ?');
      vals.push(d.status);
    }
    if (d.type !== undefined) {
      sets.push('type = ?');
      vals.push(d.type);
    }
    if (d.priority !== undefined) {
      sets.push('priority = ?');
      vals.push(d.priority);
    }
    if (d.labels !== undefined) {
      sets.push('labels = ?');
      vals.push(JSON.stringify(d.labels));
    }
    if (d.assignees !== undefined) {
      sets.push('assignees = ?');
      vals.push(JSON.stringify(d.assignees));
    }
    if (d.milestone !== undefined) {
      sets.push('milestone = ?');
      vals.push(d.milestone);
    }
    vals.push(id);
    ctx.db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id)!;
    res.json({ todo: parseTodo(row) });
  });

  r.patch('/todos/:id/move', (req, res) => {
    const { id } = req.params;
    const parsed = z.object({ status: z.enum(['open', 'in_progress', 'done']) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    ctx.db
      .prepare('UPDATE todos SET status = ?, updated_at = ? WHERE id = ?')
      .run(parsed.data.status, new Date().toISOString(), id);
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ todo: parseTodo(row) });
  });

  r.delete('/todos/:id', (req, res) => {
    ctx.db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id);
    res.status(204).send();
  });
}

function registerSessionRoute(ctx: PluginContext): void {
  ctx.router.post('/todos/:id/start-session', async (req, res) => {
    const { id } = req.params;
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const parsed = z.object({ projectId: z.string() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'projectId required' });
      return;
    }
    if (!ctx.services.chats.createChat) {
      res.status(403).json({ error: 'chat:create capability required' });
      return;
    }
    const todo = parseTodo(row);
    const { chatId } = await ctx.services.chats.createChat({ projectId: parsed.data.projectId });
    res.json({ chatId, initialMessage: buildInitialMessage(todo) });
  });
}

function registerAttachmentRoutes(ctx: PluginContext): void {
  const r = ctx.router;

  r.get('/todos/:id/attachments', async (req, res) => {
    const metas = await ctx.attachments.list(req.params.id);
    res.json({ attachments: metas });
  });

  r.post('/todos/:id/attachments', async (req, res) => {
    const row = ctx.db.prepare<{ id: string }>('SELECT id FROM todos WHERE id = ?').get(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const { filename, mimeType, data, sizeBytes } = body;
    if (typeof filename !== 'string' || typeof data !== 'string') {
      res.status(400).json({ error: 'filename and data required' });
      return;
    }
    const meta = await ctx.attachments.save(req.params.id, {
      filename,
      mimeType: typeof mimeType === 'string' ? mimeType : 'application/octet-stream',
      data,
      sizeBytes: typeof sizeBytes === 'number' ? sizeBytes : 0,
    });
    res.status(201).json({ attachment: meta });
  });

  r.get('/todos/:id/attachments/:attachmentId', async (req, res) => {
    const result = await ctx.attachments.get(req.params.id, req.params.attachmentId);
    if (!result) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(result);
  });

  r.delete('/todos/:id/attachments/:attachmentId', async (req, res) => {
    await ctx.attachments.delete(req.params.id, req.params.attachmentId);
    res.status(204).send();
  });
}

export function activate(ctx: PluginContext): void {
  ctx.db.runMigration(MIGRATION);
  registerTodoRoutes(ctx);
  registerSessionRoute(ctx);
  registerAttachmentRoutes(ctx);
  ctx.logger.info('TODO Kanban plugin activated');
  ctx.onUnload(() => {
    ctx.logger.info('TODO Kanban plugin unloaded');
  });
}
