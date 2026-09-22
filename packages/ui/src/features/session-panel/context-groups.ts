import type { ContextFile, SessionContext } from '@qlan-ro/mainframe-types';
import { estimateTokens } from './context-tokens';

export interface ContextFileRow {
  path: string;
  /** Basename — the full path is the row's tooltip. */
  label: string;
  scope: 'global' | 'project';
  tokens: number;
}

function basename(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

function toRow(file: ContextFile, scope: 'global' | 'project'): ContextFileRow {
  return { path: file.path, label: basename(file.path), scope, tokens: estimateTokens(file.content) };
}

export function deriveContextFiles(context: SessionContext | null): ContextFileRow[] {
  if (!context) return [];
  return [
    ...context.globalFiles.map((file) => toRow(file, 'global')),
    ...context.projectFiles.map((file) => toRow(file, 'project')),
  ];
}
