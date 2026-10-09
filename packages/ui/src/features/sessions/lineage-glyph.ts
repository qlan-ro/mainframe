/**
 * The one glyph per lineage relation, shared by the sidebar's fallback glyph
 * and the chat header's parent link so a task chat never draws as a fork.
 */
import { GitFork, ListChecks, type LucideIcon } from 'lucide-react';
import type { LineageRelation } from './view-model/fork-lineage';

export const LINEAGE_GLYPH: Record<LineageRelation, LucideIcon> = {
  fork: GitFork,
  delegated: ListChecks,
};
