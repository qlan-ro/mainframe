import type { CompactRow, CompactToolPart, CompactToolRow, IndexedPart, ToolKind, ToolStatus } from './types';
import { isFullCard, mergeableKinds, toolKind } from './tool-kind';
import { resolveToolStatus } from './tool-status';
import { toolRowData } from './row-data';
import { toolLabel, toolTarget } from './tool-label';

type IndexedTool = { index: number; part: CompactToolPart };

function toolRow(parts: IndexedTool[], kind: ToolKind, status: ToolStatus): CompactToolRow {
  return {
    type: 'tool',
    indices: parts.map(({ index }) => index),
    toolCallIds: parts.map(({ part }) => part.toolCallId),
    kind,
    status,
    label: toolLabel(
      parts.map(({ part }) => part),
      kind,
      status,
    ),
    ...toolRowData(
      parts.map(({ part }) => part),
      kind,
      status,
    ),
  };
}

function appendNonTool(rows: CompactRow[], { index, part }: IndexedPart): void {
  if (part.type !== 'reasoning') {
    rows.push({ type: 'passthrough', indices: [index] });
    return;
  }
  const last = rows[rows.length - 1];
  const running = part.status.type === 'running';
  if (last?.type === 'reasoning') {
    last.indices.push(index);
    last.running ||= running;
    last.label = last.running ? 'Thinking' : 'Thought';
  } else rows.push({ type: 'reasoning', indices: [index], running, label: running ? 'Thinking' : 'Thought' });
}

export function buildCompactRows(parts: readonly IndexedPart[], pendingToolIds: ReadonlySet<string>): CompactRow[] {
  const rows: CompactRow[] = [];
  let run: IndexedTool[] = [];
  let runKind: ToolKind = 'unknown';
  const flush = () => {
    if (run.length) rows.push(toolRow(run, runKind, 'success'));
    run = [];
  };
  for (const { index, part } of parts) {
    if (part.type === 'text' && !part.text.trim()) continue;
    if (part.type !== 'tool-call' || isFullCard(part.toolName)) {
      flush();
      appendNonTool(rows, { index, part });
      continue;
    }
    const kind = toolKind(part.toolName);
    const status = resolveToolStatus(part, pendingToolIds);
    const eligible = status === 'success' && mergeableKinds.has(kind) && toolTarget([part], kind) !== undefined;
    if (!eligible) {
      flush();
      rows.push(toolRow([{ index, part }], kind, status));
      continue;
    }
    if (runKind !== kind || toolTarget([...run.map(({ part }) => part), part], kind) === undefined) flush();
    runKind = kind;
    run.push({ index, part });
  }
  flush();
  return rows;
}
