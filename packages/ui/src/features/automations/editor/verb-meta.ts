/**
 * Verb/block metadata for the editor's Add-step menu and card chrome (ts153
 * wf2-base.jsx `WF2_VERB`, ported onto the exact contract step kinds). The
 * three verbs that PRODUCE tokens (`ask_agent`/`ask_me`/`run_action`) reuse
 * `sourceKindStyle` from `fields/TokenChip.tsx` so a step's card chrome and
 * its own chips never drift in color; `notify`/`if`/`repeat` get their own
 * entries. `if` reuses `--mf-accent-violet` (an exact hue match for the
 * prototype's If color); `repeat` deliberately reuses `item`'s green — the
 * block bracket and its ⟨Current item⟩ chip are the same hue in ts153 too.
 * `notify` has no pre-seeded `--mf-auto-*` token (only violet/kind-question/
 * kind-loop/kind-parallel/kind-call exist, none teal) — reusing
 * `--mf-accent-amber` here rather than hardcoding a new hex; flagged for
 * design review.
 */
import type { LucideIcon } from 'lucide-react';
import { Bell, GitBranch, MessageCircle, Plug, RotateCw, Sparkles } from 'lucide-react';
import type { AutomationStep } from '../contract';
import { sourceKindStyle } from '../fields/TokenChip';

export type VerbKind = AutomationStep['kind'];

export interface VerbMeta {
  icon: LucideIcon;
  iconClass: string;
  tintClass: string;
  borderClass: string;
  label: string;
  hint: string;
  block?: boolean;
}

const agentStyle = sourceKindStyle('agent');
const askmeStyle = sourceKindStyle('askme');
const actionStyle = sourceKindStyle('action');
const itemStyle = sourceKindStyle('item');

export const VERB_META: Record<VerbKind, VerbMeta> = {
  ask_agent: {
    icon: Sparkles,
    iconClass: agentStyle.iconClass,
    tintClass: agentStyle.tintClass,
    borderClass: agentStyle.borderClass,
    label: 'Ask agent',
    hint: 'Hand a task to an AI agent and wait for the result',
  },
  ask_me: {
    icon: MessageCircle,
    iconClass: askmeStyle.iconClass,
    tintClass: askmeStyle.tintClass,
    borderClass: askmeStyle.borderClass,
    label: 'Ask me',
    hint: 'Pause and wait for my answer',
  },
  run_action: {
    icon: Plug,
    iconClass: actionStyle.iconClass,
    tintClass: actionStyle.tintClass,
    borderClass: actionStyle.borderClass,
    label: 'Run an action',
    hint: 'A deterministic call — no agent, no tokens spent',
  },
  notify: {
    icon: Bell,
    iconClass: 'text-mf-accent-amber',
    tintClass: 'bg-mf-accent-amber/12',
    borderClass: 'border-mf-accent-amber/30',
    label: 'Notify me',
    hint: 'Send a desktop / mobile notification',
  },
  if: {
    icon: GitBranch,
    iconClass: 'text-mf-accent-violet',
    tintClass: 'bg-mf-accent-violet/12',
    borderClass: 'border-mf-accent-violet/30',
    label: 'If … otherwise',
    hint: 'Branch on a result',
    block: true,
  },
  repeat: {
    icon: RotateCw,
    iconClass: itemStyle.iconClass,
    tintClass: itemStyle.tintClass,
    borderClass: itemStyle.borderClass,
    label: 'Repeat for each',
    hint: 'Run steps once per item in a list',
    block: true,
  },
};

export const ADD_STEP_GROUPS: Array<{ label: string; kinds: VerbKind[] }> = [
  { label: 'Steps', kinds: ['ask_agent', 'ask_me', 'run_action', 'notify'] },
  { label: 'Add structure', kinds: ['if', 'repeat'] },
];
