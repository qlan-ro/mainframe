import type { TodoUpdatePayload } from './schemas.js';

/** Mirrors each defined field in a PATCH body onto the SQL `sets`/`vals` builder. */
export function applyUpdateFieldSets(sets: string[], vals: unknown[], d: TodoUpdatePayload): void {
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
  if (d.state_reason !== undefined) {
    sets.push('state_reason = ?');
    vals.push(d.state_reason);
  }
  if (d.author !== undefined) {
    sets.push('author = ?');
    vals.push(d.author);
  }
  if (d.remote_repo !== undefined) {
    sets.push('remote_repo = ?');
    vals.push(d.remote_repo);
  }
  if (d.remote_number !== undefined) {
    sets.push('remote_number = ?');
    vals.push(d.remote_number);
  }
  if (d.remote_url !== undefined) {
    sets.push('remote_url = ?');
    vals.push(d.remote_url);
  }
  if (d.synced_at !== undefined) {
    sets.push('synced_at = ?');
    vals.push(d.synced_at);
  }
}

/**
 * closed_at is a side effect of the status transition, not a client-set field:
 * stamp it when a todo first reaches `done`, clear it when it leaves `done`.
 */
export function applyStatusTransitionFields(
  sets: string[],
  vals: unknown[],
  newStatus: string,
  previousStatus: string,
  now: string,
): void {
  if (newStatus === 'done' && previousStatus !== 'done') {
    sets.push('closed_at = ?');
    vals.push(now);
  } else if (newStatus !== 'done' && previousStatus === 'done') {
    sets.push('closed_at = ?');
    vals.push(null);
  }
}
