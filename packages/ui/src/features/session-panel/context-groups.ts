/**
 * context-groups — the memory files the adapter loaded for this session.
 *
 * The daemon collects `CLAUDE.md` *and* `AGENTS.md` from both `<project>/` and
 * `<project>/.claude/`, so the payload holds 0–4 files rather than the two the
 * design sketches; every collected file gets a row. Global paths stay absolute
 * and project paths stay project-relative — the daemon distinguishes the two
 * scopes that way deliberately (issue #222), so the path is passed through.
 */
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
