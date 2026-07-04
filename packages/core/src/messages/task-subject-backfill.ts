import type { DisplayMessage, DisplayContent, ToolCallResult } from '@qlan-ro/mainframe-types';

type ProgressItem = Extract<DisplayContent, { type: 'task_progress' }>['items'][number];

const TASK_ID_RE = /Task #(\d+)/;

/**
 * Mutable walk state for one task-id namespace. The main thread is one scope;
 * every task_group (subagent) gets a fresh one — a subagent runs its own CLI
 * session whose task ids restart from 1 and would collide with the parent's.
 */
interface SubjectScope {
  /** Next sequential id to assign when a TaskCreate has no result yet. */
  nextId: number;
  /** taskId → latest known subject (creates + explicit renames). */
  subjects: Map<string, string>;
}

/** Extract the plain text of a task tool result (bare string or ToolCallResult). */
function resultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const content = (result as ToolCallResult).content;
    if (typeof content === 'string') return content;
  }
  return '';
}

/**
 * Cross-message pass that gives every task_progress item a resolvable name.
 *
 * The CLI's TaskUpdate carries only { taskId, status } — the subject exists
 * solely on the TaskCreate, which may live in an EARLIER grouped message. The
 * per-message _task_progress accumulation therefore produces update-only cards
 * that can't be named client-side. This pass walks the full display list in
 * order, records taskId → subject from TaskCreate results ("Task #N created
 * successfully: …"), and injects `subject` into later TaskUpdate inputs that
 * lack one. Pure and order-preserving; untouched messages pass by reference.
 */
export function backfillTaskSubjects(messages: DisplayMessage[]): DisplayMessage[] {
  const scope: SubjectScope = { nextId: 1, subjects: new Map() };
  return messages.map((msg) => {
    if (msg.type !== 'assistant') return msg;
    const content = backfillBlocks(msg.content, scope);
    return content === msg.content ? msg : { ...msg, content };
  });
}

/** Returns the same array reference when nothing changed (cheap delta-emitter diffing). */
function backfillBlocks(blocks: DisplayContent[], scope: SubjectScope): DisplayContent[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.type === 'task_group') {
      const calls = backfillBlocks(block.calls, { nextId: 1, subjects: new Map() });
      if (calls === block.calls) return block;
      changed = true;
      return { ...block, calls };
    }
    if (block.type !== 'task_progress') return block;
    let itemsChanged = false;
    const items = block.items.map((item) => {
      const out = backfillItem(item, scope);
      if (out !== item) itemsChanged = true;
      return out;
    });
    if (!itemsChanged) return block;
    changed = true;
    return { ...block, items };
  });
  return changed ? next : blocks;
}

function backfillItem(item: ProgressItem, scope: SubjectScope): ProgressItem {
  if (item.name === 'TaskCreate') {
    const match = TASK_ID_RE.exec(resultText(item.result));
    const id = match?.[1] ?? String(scope.nextId);
    scope.nextId = Math.max(scope.nextId, Number(id)) + 1;
    const subject = item.input['subject'];
    if (typeof subject === 'string' && subject) scope.subjects.set(id, subject);
    return item;
  }
  if (item.name === 'TaskUpdate') {
    const taskId = typeof item.input['taskId'] === 'string' ? item.input['taskId'] : String(item.input['taskId'] ?? '');
    const ownSubject = item.input['subject'];
    if (typeof ownSubject === 'string' && ownSubject) {
      // Explicit rename — record it so later updates inherit the new name.
      if (taskId) scope.subjects.set(taskId, ownSubject);
      return item;
    }
    const known = taskId ? scope.subjects.get(taskId) : undefined;
    if (!known) return item;
    return { ...item, input: { ...item.input, subject: known } };
  }
  return item;
}
