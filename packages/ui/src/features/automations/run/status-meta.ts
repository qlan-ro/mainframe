/**
 * Step-status → label/color/icon (ts153 wf2-base.jsx `WF2_RUN_STATUS`,
 * ported onto the real `AutomationStepStatus` enum and this theme's tokens).
 * `running` has no icon — RunStepRow renders the same bordered-circle
 * spinner `LastRunPill` uses instead, for one spinner treatment across the
 * feature.
 */
import { Check, ChevronDown, Clock, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AutomationStepStatus } from '../contract';

export interface StepStatusMeta {
  label: string;
  dotClass: string;
  iconClass: string;
  Icon: LucideIcon | null;
}

export const STEP_STATUS_META: Record<AutomationStepStatus, StepStatusMeta> = {
  running: { label: 'Running', dotClass: 'bg-primary/14', iconClass: 'text-primary', Icon: null },
  waiting: { label: 'Waiting', dotClass: 'bg-mf-warning/14', iconClass: 'text-mf-warning', Icon: Clock },
  succeeded: { label: 'Succeeded', dotClass: 'bg-mf-success/14', iconClass: 'text-mf-success', Icon: Check },
  failed: { label: 'Failed', dotClass: 'bg-destructive/14', iconClass: 'text-destructive', Icon: TriangleAlert },
  skipped: { label: 'Skipped', dotClass: 'bg-muted', iconClass: 'text-muted-foreground', Icon: ChevronDown },
};
