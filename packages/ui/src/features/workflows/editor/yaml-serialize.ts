/**
 * yaml-serialize — canonical YAML serializer for the workflow builder.
 *
 * `serializeWorkflow(model)` converts a WfDraft into the canonical YAML grammar
 * used on disk. The grammar tokens are authoritative:
 *   question + fields, connector + with + credential,
 *   choose / foreach / parallel / call, set,
 *   schedule { cron, on_missed }, and outputs.
 *
 * Ported from wfYamlLines / wfStepYaml in the design prototype
 * (docs/designs/workflow-ui-prototype/19-wfeditor.jsx):
 *   proto "kind: service"  → serialized as `connector:` (canonical)
 *   proto "kind: branch"   → `choose:` (canonical)
 *   proto "kind: loop"     → `foreach:` (canonical)
 *   proto "kind: subflow"  → `call:` (canonical)
 *   proto "kind: value"    → `set:` (canonical)
 *
 * YAML→model re-parse is intentionally deferred; the builder is for new
 * workflows only, and edit mode keeps the YAML text as-is.
 */

export type { WfTrigger, WfField, WfLane, WfArm, WfStep, WfInput, WfOutput, WfDraft } from './wf-draft-types';

import type { WfTrigger, WfStep, WfDraft } from './wf-draft-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function ind(n: number): string {
  return '  '.repeat(n);
}

// ── Step serializer ───────────────────────────────────────────────────────────

function serializeStep(s: WfStep, n: number, lines: string[]): void {
  const prefix = ind(n);

  switch (s.kind) {
    case 'question': {
      lines.push(`${prefix}- id: ${s.name ?? 'ask'}`);
      lines.push(`${prefix}  question:`);
      lines.push(`${prefix}    title: ${s.title ?? ''}`);
      if (s.timeout) {
        lines.push(`${prefix}    timeout: ${s.timeout}  # cancels the run if unanswered`);
      }
      if (s.fields && s.fields.length > 0) {
        lines.push(`${prefix}    fields:`);
        for (const f of s.fields) {
          const opts = f.options ? `, options: [${f.options.join(', ')}]` : '';
          const req = f.required ? ', required: true' : '';
          lines.push(`${prefix}      - { key: ${f.key}, type: ${f.type}${opts}${req} }`);
        }
      }
      break;
    }

    case 'service': {
      const connector = `${s.connector ?? 'unknown'}.${s.action ?? 'unknown'}`;
      const comment = s.title ? `  # ${s.title}` : '';
      if (s.name) {
        lines.push(`${prefix}- id: ${s.name}${comment}`);
        lines.push(`${prefix}  connector: ${connector}`);
      } else {
        lines.push(`${prefix}- connector: ${connector}${comment}`);
      }
      const args = Object.entries(s.args ?? {});
      if (args.length > 0) {
        lines.push(`${prefix}  with:`);
        for (const [key, val] of args) {
          lines.push(`${prefix}    ${key}: ${val}`);
        }
      }
      if (s.credential) {
        lines.push(`${prefix}  credential: ${s.credential}`);
      }
      break;
    }

    case 'agent': {
      lines.push(`${prefix}- id: ${s.name ?? 'agent'}`);
      lines.push(`${prefix}  agent:`);
      lines.push(`${prefix}    prompt: ${JSON.stringify(s.prompt ?? s.title ?? '')}`);
      if (s.worktree) {
        lines.push(`${prefix}    worktree: ${s.worktree}`);
      }
      break;
    }

    case 'parallel': {
      const comment = s.title ? `  # ${s.title}` : '';
      lines.push(`${prefix}- parallel:${comment}`);
      for (const ln of s.lanes ?? []) {
        lines.push(`${prefix}    ${ln.name}:`);
        for (const child of ln.steps ?? []) {
          serializeStep(child, n + 3, lines);
        }
      }
      break;
    }

    case 'branch': {
      const comment = s.title ? `  # ${s.title}` : '';
      lines.push(`${prefix}- choose:${comment}`);
      for (const a of s.arms ?? []) {
        const isElse = a.else === true || a.cond === 'else';
        if (isElse) {
          lines.push(`${prefix}    - else: true`);
        } else {
          lines.push(`${prefix}    - when: ${JSON.stringify(a.cond)}`);
        }
        lines.push(`${prefix}      steps:`);
        for (const child of a.steps ?? []) {
          serializeStep(child, n + 4, lines);
        }
      }
      break;
    }

    case 'loop': {
      const comment = s.title ? `  # ${s.title}` : '';
      lines.push(`${prefix}- foreach: ${s.over ?? 'items'}${comment}`);
      lines.push(`${prefix}  as: ${s.as ?? 'item'}`);
      lines.push(`${prefix}  steps:`);
      for (const child of s.steps ?? []) {
        serializeStep(child, n + 2, lines);
      }
      break;
    }

    case 'subflow': {
      const comment = s.title ? `  # ${s.title}` : '';
      lines.push(`${prefix}- call: ${s.ref ?? 'untitled'}${comment}`);
      const entries = Object.entries(s.with ?? {});
      if (entries.length > 0) {
        lines.push(`${prefix}  with:`);
        for (const [key, val] of entries) {
          lines.push(`${prefix}    ${key}: ${val}`);
        }
      }
      break;
    }

    default: {
      // 'set' kind and any unknown kind → set: { name: value }
      const comment = s.title ? `  # ${s.title}` : '';
      lines.push(`${prefix}- set: { ${s.name ?? 'value'}: ${JSON.stringify(s.value ?? null)} }${comment}`);
      break;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Serialize a WfDraft model into canonical YAML.
 *
 * Called live on every builder change so the YAML pane stays in sync.
 * Output is deterministic for a given model (no timestamps, no randomness).
 */
export function serializeWorkflow(d: WfDraft): string {
  const lines: string[] = [];

  lines.push(`name: ${d.name || 'untitled'}`);
  if (d.description) {
    lines.push(`description: ${d.description}`);
  }
  lines.push(`scope: ${d.scope || 'global'}`);
  lines.push('');
  lines.push('triggers:');
  serializeTriggers(d.triggers ?? [], lines);

  if (d.inputs && d.inputs.length > 0) {
    lines.push('');
    lines.push('inputs:');
    for (const i of d.inputs) {
      const def = i.default !== undefined && i.default !== '' ? `, default: ${String(i.default)}` : '';
      lines.push(`  - ${i.name}: { type: ${i.type}${def} }`);
    }
  }

  lines.push('');
  lines.push('steps:');
  for (const s of d.steps ?? []) {
    serializeStep(s, 1, lines);
  }

  const outputs = (d.outputs ?? []).filter((o) => o && o.name);
  if (outputs.length > 0) {
    lines.push('');
    lines.push('outputs:');
    for (const o of outputs) {
      lines.push(`  ${o.name}: ${o.expr || '${ ... }'}`);
    }
  }

  return lines.join('\n');
}

function serializeTriggers(triggers: WfTrigger[], lines: string[]): void {
  for (const t of triggers) {
    if (t.kind === 'schedule') {
      const cron = t.cron ?? '0 9 * * *';
      const onMissed = t.on_missed ?? t.onMissed ?? 'run_once';
      const comment = t.label ? `  # ${t.label}` : '';
      lines.push(`  - schedule: { cron: "${cron}", on_missed: ${onMissed} }${comment}`);
    } else if (t.kind === 'event') {
      lines.push(`  - event: ${t.event ?? 'chat.completed'}`);
    } else if (t.kind === 'webhook') {
      lines.push(`  - webhook: ${t.path ?? '/hook'}`);
    } else {
      lines.push(`  - manual: true`);
    }
  }
}

// ── Blank draft factory ───────────────────────────────────────────────────────

/** Returns a fresh empty draft suitable for "New workflow". */
export function blankDraft(): WfDraft {
  return {
    name: '',
    description: '',
    scope: 'project',
    triggers: [{ kind: 'manual' }],
    inputs: [],
    steps: [],
    outputs: [],
  };
}

// ── Stub factories (used by the builder's Add-step / Add-trigger buttons) ─────

const STUB_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function shortId(): string {
  let s = '';
  for (let i = 0; i < 3; i++) {
    s += STUB_ID_CHARS[Math.floor(Math.random() * STUB_ID_CHARS.length)];
  }
  return s;
}

export function stubStep(kind: WfStep['kind']): WfStep {
  const id = `${kind}_${shortId()}`;
  const base: WfStep = { id, kind, title: `${kind} step` };
  switch (kind) {
    case 'question':
      return { ...base, name: 'ask', title: 'Ask the user', fields: [{ key: 'answer', type: 'text' }] };
    case 'service':
      return { ...base, connector: 'files', action: 'append', args: { path: 'log.md', text: '${ ... }' } };
    case 'agent':
      return { ...base, name: 'agent', title: 'Ask an agent', prompt: 'Describe the task…' };
    case 'parallel':
      return {
        ...base,
        title: 'Run in parallel',
        lanes: [
          { name: 'a', steps: [] },
          { name: 'b', steps: [] },
        ],
      };
    case 'branch':
      return {
        ...base,
        title: 'Choose a path',
        arms: [
          { cond: 'true', steps: [] },
          { cond: 'else', steps: [] },
        ],
      };
    case 'loop':
      return { ...base, title: 'For each item', over: '${ items }', as: 'item', steps: [] };
    case 'subflow':
      return { ...base, title: 'Run a workflow', ref: 'ship-work' };
    default:
      return { ...base, kind: 'set', name: 'value', value: null };
  }
}

export function stubTrigger(kind: WfTrigger['kind']): WfTrigger {
  switch (kind) {
    case 'schedule':
      return { kind: 'schedule', cron: '0 9 * * *', label: 'Every day at 9:00am', onMissed: 'run_once' };
    case 'event':
      return { kind: 'event', event: 'chat.completed' };
    case 'webhook':
      return { kind: 'webhook', path: '/hook' };
    default:
      return { kind: 'manual' };
  }
}
