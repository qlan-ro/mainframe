/**
 * The one glyph per lineage relation, shared by the nested row, the fallback
 * glyph, and the hover card so a delegated child never draws as a fork.
 */
import { GitFork, ListChecks, type LucideIcon } from 'lucide-react';
import type { LineageRelation } from './view-model/fork-lineage';

export const LINEAGE_GLYPH: Record<LineageRelation, LucideIcon> = {
  fork: GitFork,
  delegated: ListChecks,
};

/** The row's meta-line label for a delegated child: `Task · <role>`. */
export function taskLabel(role: string): string {
  return `Task · ${role}`;
}
