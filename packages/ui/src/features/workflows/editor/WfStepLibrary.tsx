/**
 * WfStepLibrary — browsable catalog of the 8 workflow step kinds.
 *
 * Rendered as an overlay inside the WorkflowEditor when the user clicks
 * "Add step". Ported from WfStepLibrary / WfStepTypeCard / WF_KIND_DOC /
 * WF_LIB_GROUPS in docs/designs/workflow-ui-prototype/19-wfeditor.jsx;
 * prototype tokens translated to real Tailwind v4 / mf-* tokens.
 *
 * Props:
 *   onAdd(kind)  — called with the model WfStep kind when a card is clicked
 *   onClose()    — called after onAdd (or on the close button)
 */
import { X, Layers, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getKindMeta, KIND_META } from '../glyphs';
import type { WfStep } from './yaml-serialize';

// ── Doc metadata ──────────────────────────────────────────────────────────────

interface KindDoc {
  /** 'leaf' = Do work, 'control' = Control flow */
  flow: 'leaf' | 'control';
  blurb: string;
  produces: string;
  config: string[];
}

/**
 * Per-kind documentation shown in each card.
 * Keys use the model's WfStep['kind'] values:
 *   prototype "service" → model "service" (connector kind in glyphs.ts maps separately)
 *   prototype "value"   → model "set"
 *   prototype "branch"  → model "branch"
 *   prototype "loop"    → model "loop"
 *   prototype "subflow" → model "subflow"
 */
const KIND_DOC: Record<string, KindDoc> = {
  agent: {
    flow: 'leaf',
    blurb: 'Hand work to an AI agent in a real chat session and wait for the result.',
    produces: 'The agent’s output + a chat you can open.',
    config: ['prompt', 'model & effort', 'worktree (optional)'],
  },
  service: {
    flow: 'leaf',
    blurb: 'Call a connector action — write a file, run a command, hit an API, post to Slack, create a Notion page.',
    produces: 'Whatever the action returns.',
    config: ['connector.action', 'arguments (typed by schema)', 'credential label'],
  },
  question: {
    flow: 'leaf',
    blurb: 'Ask the user and wait. Becomes a pending interaction, answerable on desktop or mobile.',
    produces: 'The answer — one value per field.',
    config: ['title', 'form fields', 'timeout (optional)'],
  },
  set: {
    flow: 'leaf',
    blurb: 'Set or compute a value to reuse in later steps.',
    produces: 'The value, referenceable as ${name}.',
    config: ['name', 'expression'],
  },
  branch: {
    flow: 'control',
    blurb: 'Run one of several paths based on a condition — often a prior step’s output.',
    produces: 'Whatever the taken arm produces.',
    config: ['arms, each with a when-condition'],
  },
  loop: {
    flow: 'control',
    blurb: 'Run a body once per item — one step fans into N iterations at runtime.',
    produces: 'A result per item.',
    config: ['over: the list', 'body steps'],
  },
  parallel: {
    flow: 'control',
    blurb: 'Run several named lanes at the same time; continues when all finish.',
    produces: 'Each lane’s result.',
    config: ['named lanes, each a sub-sequence'],
  },
  subflow: {
    flow: 'control',
    blurb: 'Run an entire other workflow as a step; creates a linked child run.',
    produces: 'The sub-workflow’s outputs.',
    config: ['which workflow', 'inputs'],
  },
};

// ── Groups ────────────────────────────────────────────────────────────────────

interface LibGroup {
  label: string;
  sub: string;
  kinds: WfStep['kind'][];
}

const LIB_GROUPS: LibGroup[] = [
  {
    label: 'Do work',
    sub: 'Leaf steps — one unit of work',
    kinds: ['agent', 'service', 'question', 'set'],
  },
  {
    label: 'Control flow',
    sub: 'Shape the run — these nest other steps',
    kinds: ['branch', 'loop', 'parallel', 'subflow'],
  },
];

// ── WfStepTypeCard ────────────────────────────────────────────────────────────

interface WfStepTypeCardProps {
  kind: WfStep['kind'];
  onAdd: (kind: WfStep['kind']) => void;
  onClose: () => void;
}

function WfStepTypeCard({ kind, onAdd, onClose }: WfStepTypeCardProps): React.ReactElement {
  const doc = KIND_DOC[kind];
  // 'service' maps to 'connector' in KIND_META; fall back gracefully
  const meta = KIND_META[kind] ?? KIND_META['connector'] ?? getKindMeta(kind);
  const Icon = meta.Icon;
  const isControl = doc?.flow === 'control';

  function handleClick(): void {
    onAdd(kind);
    onClose();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`workflows-steplib-${kind}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        'flex cursor-pointer flex-col gap-[9px] rounded-lg border border-border bg-card p-[13px]',
        'transition-[border-color,box-shadow] duration-[120ms]',
        'hover:shadow-md',
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-[9px]">
        <span
          className={cn('inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md', 'bg-muted')}
        >
          <Icon size={16} className={meta.colorClass} aria-hidden />
        </span>
        <span className="flex-1 text-[0.9375rem] font-bold leading-tight tracking-[-0.01em] text-foreground">
          {meta.label}
        </span>
        <span
          className={cn(
            'inline-flex h-[18px] items-center rounded-full px-2',
            'text-micro font-bold uppercase tracking-wide',
            isControl
              ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
              : 'bg-muted text-mf-text-3',
          )}
        >
          {isControl ? 'Control flow' : 'Leaf'}
        </span>
        <Plus size={14} className="text-mf-text-4" aria-hidden />
      </div>

      {/* Blurb */}
      <p className="min-h-[2rem] text-caption leading-[1.5] text-muted-foreground">{doc?.blurb ?? ''}</p>

      {/* Produces + Config */}
      <div className="flex flex-col gap-[6px] border-t border-border pt-[9px]">
        <div className="flex gap-[7px]">
          <span className="w-[58px] shrink-0 pt-px text-micro font-bold uppercase tracking-[0.04em] text-mf-text-3">
            Produces
          </span>
          <span className="text-caption leading-[1.45] text-muted-foreground">{doc?.produces ?? ''}</span>
        </div>
        <div className="flex gap-[7px]">
          <span className="w-[58px] shrink-0 pt-[3px] text-micro font-bold uppercase tracking-[0.04em] text-mf-text-3">
            Config
          </span>
          <span className="flex flex-wrap gap-[5px]">
            {(doc?.config ?? []).map((c) => (
              <span
                key={c}
                className="inline-flex h-[18px] items-center rounded-[3px] bg-muted px-2 font-mono text-micro text-muted-foreground"
              >
                {c}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── WfStepLibrary ─────────────────────────────────────────────────────────────

export interface WfStepLibraryProps {
  onAdd: (kind: WfStep['kind']) => void;
  onClose: () => void;
}

/**
 * Step-type catalog rendered as an overlay panel inside the editor.
 * Two groups: "Do work" (leaf steps) and "Control flow" (composite steps).
 */
export function WfStepLibrary({ onAdd, onClose }: WfStepLibraryProps): React.ReactElement {
  return (
    <div data-testid="workflows-steplib" className="flex h-full min-h-0 flex-col bg-card">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-[10px] border-b border-border px-[16px] py-[13px]">
        <Layers size={15} className="text-primary" aria-hidden />
        <div className="flex-1">
          <div className="text-[0.9375rem] font-bold leading-tight tracking-[-0.02em] text-foreground">Step types</div>
          <div className="text-caption text-mf-text-3">Pick a step to add to the workflow</div>
        </div>
        <button
          type="button"
          aria-label="Close step library"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-mf-text-3 hover:bg-accent hover:text-foreground"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      {/* Scrollable group list */}
      <div className="flex-1 overflow-y-auto px-[18px] pb-[24px] pt-[16px]">
        {LIB_GROUPS.map((g) => (
          <div key={g.label} className="mb-[18px]">
            <div className="mb-[10px] flex items-baseline gap-[9px]">
              <span className="text-micro font-bold uppercase tracking-[0.06em] text-muted-foreground">{g.label}</span>
              <span className="text-caption text-mf-text-3">{g.sub}</span>
            </div>
            <div className="grid grid-cols-2 gap-[11px]">
              {g.kinds.map((k) => (
                <WfStepTypeCard key={k} kind={k} onAdd={onAdd} onClose={onClose} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
