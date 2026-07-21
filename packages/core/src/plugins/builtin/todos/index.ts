import type { PluginContext } from '@qlan-ro/mainframe-types';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { runMigrations } from './migrations.js';
import type { TodoRow, Todo } from './types.js';
import { parseTodo } from './types.js';
import { TodoSchema, TodoUpdateSchema, AttachmentUploadSchema } from './schemas.js';
import { applyUpdateFieldSets, applyStatusTransitionFields } from './update-fields.js';

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
    res.json({ todos: rows.map((row) => parseTodo(row, ctx.logger)) });
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
        `INSERT INTO todos (id,number,project_id,title,body,status,type,priority,labels,assignees,milestone,dependencies,order_index,created_at,updated_at,closed_at,state_reason,author,remote_repo,remote_number,remote_url,synced_at)
         VALUES (?,
           (SELECT COALESCE(MAX(number), 0) + 1 FROM todos WHERE project_id = ?),
           ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        d.closed_at ?? null,
        d.state_reason ?? null,
        d.author ?? '',
        d.remote_repo ?? null,
        d.remote_number ?? null,
        d.remote_url ?? null,
        d.synced_at ?? null,
      );
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id)!;
    const todo = parseTodo(row, ctx.logger);
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
    applyUpdateFieldSets(sets, vals, d);
    if (d.status !== undefined) {
      applyStatusTransitionFields(sets, vals, d.status, existingRow.status, now);
    }
    vals.push(id);
    ctx.db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id)!;
    const updated = parseTodo(row, ctx.logger);
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
    const existingRow = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id);
    if (!existingRow) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const now = new Date().toISOString();
    const sets: string[] = ['status = ?', 'updated_at = ?'];
    const vals: unknown[] = [status, now];
    applyStatusTransitionFields(sets, vals, status, existingRow.status, now);
    vals.push(id);
    ctx.db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE id = ?').get(id)!;
    const todo = parseTodo(row, ctx.logger);
    if (status === 'done' && todo.dependencies.length > 0) {
      const openDeps = todo.dependencies
        .map((num) =>
          ctx.db.prepare<TodoRow>('SELECT * FROM todos WHERE number = ? AND project_id = ?').get(num, todo.project_id),
        )
        .filter((r): r is TodoRow => r !== undefined)
        .map((r) => parseTodo(r, ctx.logger))
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
    const todo = parseTodo(row, ctx.logger);
    const depTodos =
      todo.dependencies.length > 0
        ? todo.dependencies
            .map((num) =>
              ctx.db
                .prepare<TodoRow>('SELECT * FROM todos WHERE number = ? AND project_id = ?')
                .get(num, todo.project_id),
            )
            .filter((r): r is TodoRow => r !== undefined)
            .map((r) => parseTodo(r, ctx.logger))
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
    const parsed = AttachmentUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }
    const { filename, mimeType, data, sizeBytes } = parsed.data;
    const meta = await ctx.attachments.save(req.params.id, {
      filename,
      mimeType: mimeType ?? 'application/octet-stream',
      data,
      sizeBytes: sizeBytes ?? 0,
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
  runMigrations(ctx);
  registerTodoRoutes(ctx);
  registerSessionRoute(ctx);
  registerAttachmentRoutes(ctx);

  // Primary fullview: Kanban board.
  const kanbanPanelId = ctx.ui.addPanel({ zone: 'fullview', label: 'Tasks', icon: 'square-check' });
  // Secondary right-top zone: quick-add summary sidebar (stub — wired up for plumbing demo).
  const sidebarPanelId = ctx.ui.addPanel({ zone: 'right-top', label: 'Tasks Sidebar', icon: 'list-todo' });

  ctx.ui.addAction({ id: 'quick-create', label: 'New Task', shortcut: 'mod+t', icon: 'plus' });

  ctx.onUnload(() => {
    ctx.ui.removePanel(kanbanPanelId);
    ctx.ui.removePanel(sidebarPanelId);
    ctx.ui.removeAction('quick-create');
  });
  ctx.logger.info('TODO Kanban plugin activated');
}
