import type { DiffStats } from './types';
import { displayText } from './values';

export function normalizedPath(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.replace(/\\/g, '/') : '';
}

function commonDirectory(paths: readonly string[]): string {
  const directories = paths.map((path) => path.split('/').slice(0, -1));
  const common = [...directories[0]!];
  for (const directory of directories.slice(1)) {
    while (common.length && !common.every((segment, index) => segment === directory[index])) common.pop();
  }
  const result = common.join('/');
  return !result || /^[A-Za-z]:$/.test(result) || /^\/\/[^/]+(?:\/[^/]+)?$/.test(result) ? '' : result;
}

export function summarizeFiles(paths: readonly unknown[], operation: 'read' | 'edit' | 'write'): string | undefined {
  const normalized = paths.map(normalizedPath);
  if (!normalized.length || normalized.some((path) => !path || path.endsWith('/'))) return undefined;
  const distinct = [...new Set(normalized)];
  if (distinct.length === 1) {
    return displayText(distinct[0]) + (paths.length > 1 ? ` (${paths.length} ${operation}s)` : '');
  }
  const directory = commonDirectory(distinct);
  return `${distinct.length} files${directory ? ` in ${displayText(directory)}` : ''}`;
}

export function sumDiffStats(stats: readonly (DiffStats | null | undefined)[]): DiffStats | undefined {
  if (!stats.length || stats.some((value) => !value)) return undefined;
  return stats.reduce<DiffStats>(
    (total, value) => ({
      added: total.added + value!.added,
      removed: total.removed + value!.removed,
    }),
    { added: 0, removed: 0 },
  );
}
