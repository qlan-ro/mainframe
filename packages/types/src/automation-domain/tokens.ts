/**
 * Token model — the "invisible rule made concrete" (ts153 wf2-base.jsx
 * `wf2StepProduces`/`wf2GroupTokens`, ported onto the exact contract step
 * kinds and NAMED camelCase outputs, contract §1/§5).
 *
 * A token is a pickable value produced upstream, addressed by a flat
 * `TokenRef {stepId, output, field?}` (never shown to the user — display
 * always resolves through a `TokenDescriptor`). Colors/icons are a
 * presentation concern and deliberately NOT modeled here — this module is
 * pure data + scope rules; `sourceKind` gives the UI layer enough to pick a
 * theme color/icon per source family (`packages/ui/.../fields/`).
 *
 * Lives in `@qlan-ro/mainframe-types` (docs/plans/2026-07-12-automations-v2-ui.md
 * "Decision: where pure logic lives") rather than `mainframe-core`, whose
 * Node-only deps (better-sqlite3, pino) make it unimportable from the
 * browser renderer — this package is browser-safe and already a dep of both
 * `ui` and `core`, so the daemon's canonical validation can import the same
 * functions the UI does.
 */
import type {
  ActionCatalogEntry,
  AutomationDefinition,
  AutomationStep,
  AutomationTrigger,
  TokenRef,
} from '../automation.js';
import { TOKEN_STEP_BUILTIN, TOKEN_STEP_CURRENT, TOKEN_STEP_TRIGGER } from '../automation.js';

export type TokenValueType = 'text' | 'number' | 'list' | 'choice' | 'date' | 'object';
export type TokenSourceKind = 'builtin' | 'trigger' | 'agent' | 'askme' | 'action' | 'item';

export interface TokenDescriptor {
  ref: TokenRef;
  label: string;
  type: TokenValueType;
  sourceKind: TokenSourceKind;
  /** Human label for the picker's group header — the step's display name, or 'Trigger'/'Built-in'/'Repeat'. */
  source: string;
  /** Sub-field names when this token's value is a record (or, for a list token, the shape of each item — used by Repeat's Current item). */
  fields?: string[];
  /** For choice/multi tokens: the authored option set. */
  options?: string[];
}

/**
 * Known item-shape for actions whose output is a list of records (contract §5
 * only documents one today: `github.list_prs → prs: list (items {url, title,
 * number, author})`). `ActionCatalogEntry.outputs` carries no nested-field
 * metadata, so this small table is the one place that knowledge lives; add an
 * entry here whenever a future action's list output needs field expansion.
 */
const ACTION_LIST_ITEM_FIELDS: Record<string, string[]> = {
  'github.list_prs': ['url', 'title', 'number', 'author'],
};

export function builtinTokens(): TokenDescriptor[] {
  return [
    {
      ref: { stepId: TOKEN_STEP_BUILTIN, output: 'today' },
      label: 'Today',
      type: 'date',
      sourceKind: 'builtin',
      source: 'Built-in',
    },
    {
      ref: { stepId: TOKEN_STEP_BUILTIN, output: 'now' },
      label: 'Now',
      type: 'date',
      sourceKind: 'builtin',
      source: 'Built-in',
    },
  ];
}

/**
 * Curated event triggers produce `result`/`chatId` (automation.ts's doc
 * comment). Webhook triggers produce a `payload` object dug into via `field`
 * — its shape is only known once a sample is captured (editor concern, not
 * modeled here). Schedule triggers produce nothing.
 */
export function triggerTokens(triggers: AutomationTrigger[]): TokenDescriptor[] {
  const out: TokenDescriptor[] = [];
  for (const trigger of triggers) {
    if (trigger.kind === 'event') {
      out.push(
        {
          ref: { stepId: TOKEN_STEP_TRIGGER, output: 'result' },
          label: 'Result',
          type: 'text',
          sourceKind: 'trigger',
          source: 'Trigger',
        },
        {
          ref: { stepId: TOKEN_STEP_TRIGGER, output: 'chatId' },
          label: 'Chat',
          type: 'text',
          sourceKind: 'trigger',
          source: 'Trigger',
        },
      );
    } else if (trigger.kind === 'webhook') {
      out.push({
        ref: { stepId: TOKEN_STEP_TRIGGER, output: 'payload' },
        label: 'Payload',
        type: 'object',
        sourceKind: 'trigger',
        source: 'Trigger',
      });
    }
  }
  return out;
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** camelCase output-name -> friendly label, for actions whose outputs aren't self-descriptive as-is. */
const OUTPUT_LABELS: Record<string, string> = {
  output: 'Output',
  exitCode: 'Exit code',
  content: 'File text',
  status: 'Status',
  body: 'Response',
  prUrl: 'PR URL',
  prNumber: 'PR number',
  prs: 'Open PRs',
  pageUrl: 'Page URL',
  workItemId: 'Work item ID',
  url: 'URL',
  result: 'Result',
};

function outputLabel(name: string): string {
  return OUTPUT_LABELS[name] ?? capitalize(name);
}

/** Recursively finds a step by id, descending into `if`'s then/otherwise and `repeat`'s inner steps — the same tree shape `walk` traverses below. */
export function findStepById(steps: AutomationStep[], stepId: string): AutomationStep | null {
  for (const step of steps) {
    if (step.id === stepId) return step;
    if (step.kind === 'if') {
      const inThen = findStepById(step.then, stepId);
      if (inThen) return inThen;
      const inOtherwise = findStepById(step.otherwise, stepId);
      if (inOtherwise) return inOtherwise;
    } else if (step.kind === 'repeat') {
      const inner = findStepById(step.steps, stepId);
      if (inner) return inner;
    }
  }
  return null;
}

/** A step's display label — steps carry no free-text name in the wire contract, so this is the verb/action label (Ask-me's `title` is the one contract exception). */
export function stepLabel(step: AutomationStep, catalog: ActionCatalogEntry[]): string {
  switch (step.kind) {
    case 'ask_agent':
      return 'Ask agent';
    case 'ask_me':
      return step.title || 'Ask me';
    case 'run_action': {
      const action = catalog.find((a) => a.id === step.actionId);
      return action?.title || 'Run an action';
    }
    case 'notify':
      return 'Notify me';
    case 'if':
      return 'If … otherwise';
    case 'repeat':
      return 'Repeat for each';
  }
}

function askMeFieldType(type: 'text' | 'number' | 'choice' | 'multi' | 'textarea'): TokenValueType {
  if (type === 'multi') return 'list';
  if (type === 'choice') return 'choice';
  if (type === 'number') return 'number';
  return 'text';
}

/**
 * Tokens a single step produces (contract §5's named-output table). `if`
 * aggregates everything produced inside BOTH `then` and `otherwise` — branch
 * results leak to later siblings once the block closes (`scopeAt` below).
 * `repeat` produces nothing here: its `Current item` token is isolated to its
 * own `steps` and is synthesized by `scopeAt`, never by this function.
 */
export function stepProduces(step: AutomationStep, catalog: ActionCatalogEntry[]): TokenDescriptor[] {
  const source = stepLabel(step, catalog);
  switch (step.kind) {
    case 'ask_agent': {
      const out: TokenDescriptor[] = [
        { ref: { stepId: step.id, output: 'result' }, label: 'Result', type: 'text', sourceKind: 'agent', source },
        { ref: { stepId: step.id, output: 'chatId' }, label: 'Chat', type: 'text', sourceKind: 'agent', source },
      ];
      for (const expected of step.expects ?? []) {
        const descriptor: TokenDescriptor = {
          ref: { stepId: step.id, output: expected.key },
          label: capitalize(expected.key),
          type: expected.type,
          sourceKind: 'agent',
          source,
        };
        if (expected.options) descriptor.options = expected.options;
        out.push(descriptor);
      }
      return out;
    }
    case 'ask_me':
      return step.fields
        .filter((f) => f.key)
        .map((f) => {
          const descriptor: TokenDescriptor = {
            ref: { stepId: step.id, output: f.key },
            label: f.label || f.key,
            type: askMeFieldType(f.type),
            sourceKind: 'askme',
            source,
          };
          if (f.options) descriptor.options = f.options;
          return descriptor;
        });
    case 'run_action': {
      const action = catalog.find((a) => a.id === step.actionId);
      if (!action) return [];
      return action.outputs.map((o) => {
        const descriptor: TokenDescriptor = {
          ref: { stepId: step.id, output: o.name },
          label: outputLabel(o.name),
          type: o.type === 'record' ? 'object' : o.type,
          sourceKind: 'action',
          source,
        };
        const itemFields = ACTION_LIST_ITEM_FIELDS[step.actionId];
        if (o.type === 'list' && itemFields) descriptor.fields = itemFields;
        return descriptor;
      });
    }
    case 'notify':
      return [];
    case 'if': {
      const out: TokenDescriptor[] = [];
      for (const s of step.then) out.push(...stepProduces(s, catalog));
      for (const s of step.otherwise) out.push(...stepProduces(s, catalog));
      return out;
    }
    case 'repeat':
      return [];
  }
}

/** Synthesize Repeat's `Current item` token from the list token its `items` ref points to (visible only inside `steps`; never returned by `stepProduces`). */
function currentItemToken(itemsRef: TokenRef, scope: TokenDescriptor[]): TokenDescriptor | null {
  const listToken = scope.find((t) => t.ref.stepId === itemsRef.stepId && t.ref.output === itemsRef.output);
  if (!listToken) return null;
  const descriptor: TokenDescriptor = {
    ref: { stepId: TOKEN_STEP_CURRENT, output: 'item' },
    label: 'Current item',
    type: 'text',
    sourceKind: 'item',
    source: 'Repeat',
  };
  if (listToken.fields) descriptor.fields = listToken.fields;
  return descriptor;
}

interface WalkResult {
  found: boolean;
  scope: TokenDescriptor[];
}

function walk(
  steps: AutomationStep[],
  scope: TokenDescriptor[],
  targetStepId: string | null,
  catalog: ActionCatalogEntry[],
): WalkResult {
  let running = scope;
  for (const step of steps) {
    if (step.id === targetStepId) return { found: true, scope: running };
    if (step.kind === 'if') {
      const thenResult = walk(step.then, running, targetStepId, catalog);
      if (thenResult.found) return thenResult;
      const otherwiseResult = walk(step.otherwise, running, targetStepId, catalog);
      if (otherwiseResult.found) return otherwiseResult;
      running = running.concat(stepProduces(step, catalog));
    } else if (step.kind === 'repeat') {
      const itemToken = currentItemToken(step.items, running);
      const innerScope = itemToken ? running.concat([itemToken]) : running;
      const repeatResult = walk(step.steps, innerScope, targetStepId, catalog);
      if (repeatResult.found) return repeatResult;
      // Isolated: no leak after the block, even though repeatResult.scope may hold Current item.
    } else {
      running = running.concat(stepProduces(step, catalog));
    }
  }
  return { found: false, scope: running };
}

/**
 * Tokens visible immediately before `targetStepId` — trigger tokens + built-ins
 * + every token produced by earlier siblings at this level or an ancestor.
 * Pass `null` to get the scope after the ENTIRE top-level recipe (e.g. for a
 * step about to be appended at the end).
 */
export function scopeAt(
  definition: AutomationDefinition,
  catalog: ActionCatalogEntry[],
  targetStepId: string | null,
): TokenDescriptor[] {
  const base = builtinTokens().concat(triggerTokens(definition.triggers));
  return walk(definition.steps, base, targetStepId, catalog).scope;
}
