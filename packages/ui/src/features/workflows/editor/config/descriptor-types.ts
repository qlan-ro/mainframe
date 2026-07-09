/**
 * Descriptor types for the per-kind config form renderer, plus immutable
 * dotted-path get/set helpers used to patch a `WfStep` from a field descriptor.
 * See docs/plans/2026-07-09-workflow-step-config-plan.md Task 10.
 */

import type React from 'react';
import type { WfStep } from '../wf-draft-types';
import type { WfScopeSource } from './wf-scope';

export interface WfCustomSlotProps {
  step: WfStep;
  onPatch: (patch: Partial<WfStep>) => void;
  scope: WfScopeSource[];
}

export type WfFieldDesc =
  | { kind: 'text' | 'textarea'; key: string; label: string; expr?: true; placeholder?: string }
  | { kind: 'select'; key: string; label: string; options: Array<{ value: string; label: string }> }
  | { kind: 'toggle'; key: string; label: string }
  | { kind: 'number'; key: string; label: string }
  | { kind: 'kv'; key: string; label: string; expr?: true }
  | { kind: 'custom'; key: string; component: React.ComponentType<WfCustomSlotProps> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `path` is a dotted path into the step, e.g. 'agent.prompt', 'form.title'. */
export function getByPath(step: WfStep, path: string): unknown {
  let cur: unknown = step;
  for (const key of path.split('.')) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Immutable: clones only the objects along the touched spine; never mutates `step`. */
export function setByPath(step: WfStep, path: string, value: unknown): WfStep {
  const keys = path.split('.');
  const root: Record<string, unknown> = { ...(step as unknown as Record<string, unknown>) };
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    const existing = cur[key];
    cur[key] = isPlainObject(existing) ? { ...existing } : {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
  return root as unknown as WfStep;
}
