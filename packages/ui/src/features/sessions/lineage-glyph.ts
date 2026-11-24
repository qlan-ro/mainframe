/**
 * The one glyph per lineage relation, so a task chat never draws as a fork.
 */
import { ListChecks, Split, type LucideIcon } from 'lucide-react';
import type { LineageRelation } from './view-model/fork-lineage';

export const LINEAGE_GLYPH: Record<LineageRelation, LucideIcon> = {
  fork: Split,
  delegated: ListChecks,
};
