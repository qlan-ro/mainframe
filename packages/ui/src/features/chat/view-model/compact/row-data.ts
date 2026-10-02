import type { ToolCallTiming } from '@assistant-ui/react';
import { resolveToolDiff } from '../../tools/shared/diff-data';
import type { CompactToolPart, CompactToolRow, ToolKind, ToolStatus } from './types';
import { sumDiffStats } from './file-summary';
import { record } from './values';

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function suppliedTiming(value: unknown): ToolCallTiming | undefined {
  const data = record(value);
  if (!data || !nonnegative(data.startedAt)) return undefined;
  if (data.completedAt !== undefined && (!nonnegative(data.completedAt) || data.completedAt < data.startedAt))
    return undefined;
  return {
    startedAt: data.startedAt,
    ...(data.completedAt !== undefined && { completedAt: data.completedAt as number }),
  };
}

export function toolRowData(
  parts: readonly CompactToolPart[],
  kind: ToolKind,
  status: ToolStatus,
): Pick<CompactToolRow, 'diff' | 'timing' | 'reportedDurationMs'> {
  const diff =
    kind === 'edit' || kind === 'write'
      ? sumDiffStats(
          parts.map((part) => resolveToolDiff(kind === 'edit' ? 'Edit' : 'Write', part.args, part.result).stats),
        )
      : undefined;
  const data: Pick<CompactToolRow, 'diff' | 'timing' | 'reportedDurationMs'> = diff ? { diff } : {};
  if (parts.length !== 1) return data;
  const part = parts[0]!;
  const timing = suppliedTiming(part.timing);
  if (timing) data.timing = timing;
  const duration = record(part.providerMetadata?.codex)?.reportedDurationMs;
  if (['success', 'failed', 'stopped', 'declined'].includes(status) && nonnegative(duration))
    data.reportedDurationMs = duration;
  return data;
}
