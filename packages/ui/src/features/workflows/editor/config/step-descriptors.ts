/**
 * Per-kind field descriptor lists for the config form renderer (Task 12
 * maps these to `WfFieldControl`s via `WfStepConfigForm`).
 *
 * Every kind's list ends with the shared Advanced descriptors: `retry`
 * (attempts count), an `onFailure` select (descriptor `key: 'onFailure'` —
 * the model field from `WfStepBase.onFailure`, Task 3 — not the YAML key
 * `on_failure`, which Task 7 maps to/from it), and an `output` expr-text
 * field. `output`'s control always writes a string, but the model field is
 * `unknown` (Task 3 / Finding 2) — a hydrated non-string `output:` is left
 * alone by `getByPath`/`setByPath` until the user edits this field.
 */
import type { WfFieldDesc } from './descriptor-types';
import type { WfStepKind } from '../wf-draft-types';
import { AgentConfigSlot } from './AgentConfigSlot';
import { FormFieldsSlot } from './FormFieldsSlot';
import { WfChooseArmsEditor } from './WfChooseArmsEditor';
import { WfParallelBranchesEditor } from './WfParallelBranchesEditor';

const ADVANCED_DESCRIPTORS: WfFieldDesc[] = [
  { kind: 'number', key: 'retry.attempts', label: 'Retry attempts' },
  {
    kind: 'select',
    key: 'onFailure',
    label: 'On failure',
    options: [
      { value: 'fail', label: 'Fail' },
      { value: 'continue', label: 'Continue' },
    ],
  },
  { kind: 'text', key: 'output', label: 'Output', expr: true },
];

const PER_KIND_DESCRIPTORS: Record<WfStepKind, WfFieldDesc[]> = {
  agent: [{ kind: 'custom', key: 'agent', component: AgentConfigSlot }],
  form: [
    { kind: 'text', key: 'form.title', label: 'Title' },
    { kind: 'custom', key: 'form.fields', component: FormFieldsSlot },
    { kind: 'number', key: 'form.timeout.afterMinutes', label: 'Timeout (minutes)' },
    {
      kind: 'select',
      key: 'form.timeout.onTimeout',
      label: 'On timeout',
      options: [
        { value: 'cancel', label: 'Cancel' },
        { value: 'fail', label: 'Fail' },
        { value: 'continue', label: 'Continue' },
      ],
    },
  ],
  service: [
    { kind: 'text', key: 'connector', label: 'Connector' },
    { kind: 'kv', key: 'with', label: 'With', expr: true },
    { kind: 'text', key: 'credential', label: 'Credential' },
  ],
  choose: [{ kind: 'custom', key: 'arms', component: WfChooseArmsEditor }],
  foreach: [
    { kind: 'text', key: 'over', label: 'Over', expr: true },
    { kind: 'text', key: 'as', label: 'As' },
  ],
  parallel: [{ kind: 'custom', key: 'branches', component: WfParallelBranchesEditor }],
  call: [
    { kind: 'text', key: 'ref', label: 'Workflow ref' },
    { kind: 'kv', key: 'with', label: 'With', expr: true },
  ],
  set: [{ kind: 'kv', key: 'set', label: 'Set', expr: true }],
};

export function descriptorsFor(kind: WfStepKind): WfFieldDesc[] {
  return [...PER_KIND_DESCRIPTORS[kind], ...ADVANCED_DESCRIPTORS];
}
