import { normalizedPath, summarizeFiles } from './file-summary';
import { displayText, record } from './values';

export type CommandActionSummary = { kind: 'read' | 'grep' | 'list'; target: string };

function actionSummary(value: unknown): CommandActionSummary | undefined {
  const action = record(value);
  if (!action || !displayText(action.command)) return undefined;
  if (action.type === 'read') {
    const path = normalizedPath(action.path);
    return path && displayText(action.name) ? { kind: 'read', target: path } : undefined;
  }
  if (action.type === 'listFiles') {
    const path = normalizedPath(action.path);
    return path ? { kind: 'list', target: path } : undefined;
  }
  if (action.type !== 'search' || !displayText(action.query)) return undefined;
  if (action.path != null && typeof action.path !== 'string') return undefined;
  const path = normalizedPath(action.path);
  return { kind: 'grep', target: `for "${displayText(action.query)}"${path ? ` in ${path}` : ''}` };
}

export function summarizeCommandActions(value: unknown): CommandActionSummary | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const actions = value.map(actionSummary);
  const first = actions[0];
  if (!first || actions.some((action) => !action || action.kind !== first.kind)) return undefined;
  if (first.kind === 'read') {
    const target = summarizeFiles(
      actions.map((action) => action!.target),
      'read',
    );
    return target ? { kind: 'read', target } : undefined;
  }
  if (actions.some((action) => action!.target !== first.target)) return undefined;
  const count = actions.length > 1 ? ` (${actions.length} ${first.kind === 'grep' ? 'searches' : 'listings'})` : '';
  return { kind: first.kind, target: first.target + count };
}
