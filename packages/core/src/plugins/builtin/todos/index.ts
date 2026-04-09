import type { PluginContext } from '@qlan-ro/mainframe-types';
import { nanoid } from 'nanoid';
import { z } from 'zod';

interface TodoRow {
  id: string;
  number: number;
  project_id: string;
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
  dependencies: string; // JSON array of todo numbers
}

interface Todo extends Omit<TodoRow, 'labels' | 'assignees' | 'dependencies'> {
  labels: string[];
  assignees: string[];
  dependencies: number[];
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL DEFAULT 0,
  project_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  type TEXT NOT NULL DEFAULT 'feature',
  priority TEXT NOT NULL DEFAULT 'medium',
  labels TEXT NOT NULL DEFAULT '[]',
  assignees TEXT NOT NULL DEFAULT '[]',
  milestone TEXT,
  dependencies TEXT NOT NULL DEFAULT '[]',
  order_index REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

const parseTodo = (r: TodoRow): Todo => ({
  ...r,
  labels: JSON.parse(r.labels) as string[],
  assignees: JSON.parse(r.assignees) as string[],
  dependencies: JSON.parse(r.dependencies || '[]') as number[],
});

const TodoSchema = z.object({
  projectId: z.string().min(1),
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
  dependencies: z.array(z.number()).default([]),
});

const TodoUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  status: z.enum(['open', 'in_progress', 'done']).optional(),
  type: z
    .enum(['bug', 'feature', 'enhancement', 'documentation', 'question', 'wont_fix', 'duplicate', 'invalid'])
    .optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
  milestone: z.string().optional(),
  dependencies: z.array(z.number()).optional(),
});

const STATUS_LABELS: Record<string, string> = { open: 'Open', in_progress: 'In Progress', done: 'Done' };

function buildInitialMessage(todo: Todo, depTodos: Todo[]): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const labels = todo.labels.length > 0 ? todo.labels.join(', ') : 'none';
  const lines = [
    `**#${todo.number} ${todo.title}**`,
    `Type: ${cap(todo.type)} | Priority: ${cap(todo.priority)} | Labels: ${labels}`,
  ];
  if (todo.milestone) lines.push(`Milestone: ${todo.milestone}`);
  if (depTodos.length > 0) {
    lines.push(`Dependencies: ${depTodos.map((d) => `#${d.number} ${d.title} (${d.status})`).join(', ')}`);
  }
  if (todo.body) lines.push(``, `## Description`, todo.body);
  return lines.join('\n');
}

function registerTodoRoutes(ctx: PluginContext): void {
  const r = ctx.router;

  r.get('/todos', (req, res) => {
    const projectId = req.query['projectId'] as string | undefined;
    if (!projectId) {
      res.status(400).json({ error: 'projectId required' });
      return;
    }
    const rows = ctx.db
      .prepare<TodoRow>('SELECT * FROM todos WHERE project_id = ? ORDER BY status, order_index, created_at')
      .all(projectId);
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
        `INSERT INTO todos (id,number,project_id,title,body,status,type,priority,labels,assignees,milestone,dependencies,order_index,created_at,updated_at)
         VALUES (?,
           (SELECT COALESCE(MAX(number), 0) + 1 FROM todos WHERE project_id = ?),
           ?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        d.projectId,
        d.projectId,
        d.title,
        d.body,
        d.status,
        d.type,
        d.priority,
        JSON.stringify(d.labels),
        JSON.stringify(d.assignees),
        d.milestone ?? null,
        JSON.stringify(d.dependencies),
        0,
        now,
        now,
      );
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id)!;
    const todo = parseTodo(row);
    res.status(201).json({ todo });
  });

  r.patch('/todos/:id', (req, res) => {
    const { id } = req.params;
    const existingRow = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id);
    if (!existingRow) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const parsed = TodoUpdateSchema.safeParse(req.body);
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
    if (d.dependencies !== undefined) {
      sets.push('dependencies = ?');
      vals.push(JSON.stringify(d.dependencies));
    }
    vals.push(id);
    ctx.db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id)!;
    const updated = parseTodo(row);
    if (d.status !== undefined && d.status !== existingRow.status) {
      ctx.ui.notify({
        title: `#${updated.number} ${updated.title}`,
        body: `Moved to ${STATUS_LABELS[d.status] ?? d.status}`,
        level: 'success',
      });
    }
    res.json({ todo: updated });
  });

  r.patch('/todos/:id/move', (req, res) => {
    const { id } = req.params;
    const parsed = z.object({ status: z.enum(['open', 'in_progress', 'done']) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    const { status } = parsed.data;
    ctx.db
      .prepare('UPDATE todos SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const todo = parseTodo(row);
    if (status === 'done' && todo.dependencies.length > 0) {
      const openDeps = todo.dependencies
        .map((num) =>
          ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE number = ? AND project_id = ?').get(num, todo.project_id),
        )
        .filter((r): r is TodoRow => r !== undefined)
        .map(parseTodo)
        .filter((d) => d.status !== 'done');
      if (openDeps.length > 0) {
        const names = openDeps.map((d) => `#${d.number} ${d.title}`).join(', ');
        ctx.ui.notify({ title: `#${todo.number} ${todo.title} has open dependencies`, body: names, level: 'warning' });
      }
    }
    res.json({ todo });
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
    const depTodos =
      todo.dependencies.length > 0
        ? todo.dependencies
            .map((num) =>
              ctx.db
                .prepare<TodoRow>('SELECT * FROM todos WHERE number = ? AND project_id = ?')
                .get(num, todo.project_id),
            )
            .filter((r): r is TodoRow => r !== undefined)
            .map(parseTodo)
        : [];
    const { chatId } = await ctx.services.chats.createChat({ projectId: parsed.data.projectId });
    res.json({ chatId, initialMessage: buildInitialMessage(todo, depTodos) });
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

function runMigrations(ctx: PluginContext): void {
  ctx.db.runMigration(MIGRATION);
  const cols = ctx.db.prepare<{ name: string }>('PRAGMA table_info(todos)').all();
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('number')) {
    ctx.db.runMigration('ALTER TABLE todos ADD COLUMN number INTEGER NOT NULL DEFAULT 0');
    const rows = ctx.db.prepare<{ id: string }>('SELECT id FROM todos ORDER BY created_at').all();
    rows.forEach((row, i) => {
      ctx.db.prepare('UPDATE todos SET number = ? WHERE id = ?').run(i + 1, row.id);
    });
  }
  if (!colNames.has('project_id')) {
    ctx.db.runMigration("ALTER TABLE todos ADD COLUMN project_id TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has('dependencies')) {
    ctx.db.runMigration("ALTER TABLE todos ADD COLUMN dependencies TEXT NOT NULL DEFAULT '[]'");
  }
}

export function activate(ctx: PluginContext): void {
  runMigrations(ctx);
  registerTodoRoutes(ctx);
  registerSessionRoute(ctx);
  registerAttachmentRoutes(ctx);
  ctx.ui.addPanel({ zone: 'fullview', label: 'Tasks', icon: 'square-check' });
  ctx.ui.addAction({ id: 'quick-create', label: 'New Task', shortcut: 'mod+t', icon: 'plus' });
  ctx.onUnload(() => {
    ctx.ui.removePanel();
    ctx.ui.removeAction('quick-create');
  });
  ctx.logger.info('TODO Kanban plugin activated');
}
