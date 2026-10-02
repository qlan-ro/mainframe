import type { CompactToolPart, ToolKind, ToolStatus } from './types';
import { actionLabel } from './action-label';
import { commandLabel } from './command-label';
import { normalizedPath, summarizeFiles } from './file-summary';
import { displayText, record } from './values';

function searchTarget(parts: readonly CompactToolPart[], kind: 'glob' | 'grep'): string | undefined {
  const inputs = parts.map((part) => {
    const args = record(part.args);
    return { pattern: displayText(args?.pattern ?? args?.glob), path: normalizedPath(args?.path) };
  });
  const first = inputs[0]!;
  if (!first.pattern || inputs.some((input) => input.pattern !== first.pattern || input.path !== first.path))
    return undefined;
  const count = parts.length > 1 ? ` (${parts.length} searches)` : '';
  return `${kind === 'glob' ? 'matching' : 'for'} "${first.pattern}"${first.path ? ` in ${first.path}` : ''}${count}`;
}

function countedTarget(values: string[], noun: string, operation: string): string | undefined {
  if (values.some((value) => !value)) return undefined;
  const distinct = [...new Set(values)];
  if (distinct.length === 1) return distinct[0] + (values.length > 1 ? ` (${values.length} ${operation})` : '');
  return `${distinct.length} ${noun}`;
}

export function toolTarget(parts: readonly CompactToolPart[], kind: ToolKind): string | undefined {
  if (!parts.length) return undefined;
  const args = parts.map((part) => record(part.args));
  if (kind === 'read' || kind === 'edit' || kind === 'write')
    return summarizeFiles(
      args.map((arg) => arg?.file_path),
      kind,
    );
  if (kind === 'glob' || kind === 'grep') return searchTarget(parts, kind);
  if (kind === 'list')
    return countedTarget(
      args.map((arg) => normalizedPath(arg?.path)),
      'directories',
      'listings',
    );
  if (kind === 'fetch')
    return countedTarget(
      args.map((arg) => displayText(arg?.url)),
      'pages',
      'fetches',
    );
  if (kind === 'web-search') {
    const queries = args.map((arg) => displayText(arg?.query));
    if (queries.some((query) => !query)) return undefined;
    return (
      `for ${[...new Set(queries)].map((query) => `"${query}"`).join(', ')}` +
      (new Set(queries).size === 1 && queries.length > 1 ? ` (${queries.length} searches)` : '')
    );
  }
  if (kind === 'subagent') return displayText(args[0]?.subagent_type) || displayText(args[0]?.description) || 'Task';
  return undefined;
}

export function toolLabel(parts: readonly CompactToolPart[], kind: ToolKind, status: ToolStatus): string {
  const part = parts[0]!;
  if (kind === 'shell') return commandLabel(part, status);
  if (kind === 'unknown' || kind === 'mcp') {
    return actionLabel({ kind: 'command', target: displayText(part.toolName) || 'tool' }, status);
  }
  return actionLabel({ kind, target: toolTarget(parts, kind) }, status);
}
