/**
 * ActionCatalog — searchable, source-segmented action picker (ts153
 * wf2-stepconfig.jsx `WfActionCatalog`, ported onto contract action ids and
 * embedded directly in `ActionConfig` rather than a separate modal —
 * `StepCard`'s own "Set up" disclosure is already the containing chrome).
 *
 * `ActionCatalogEntry` carries no icon/blurb/advanced-flag (contract §1
 * keeps it thin: id/title/group/auth/credentialLabelHint/paramsSchema/
 * outputs) — `ACTION_ICONS`/`ACTION_BLURBS`/`ADVANCED_ACTION_IDS` below are
 * this component's UI-local presentation tables, the same pattern
 * `domain/tokens.ts`'s `ACTION_LIST_ITEM_FIELDS` already uses. LIST is
 * derived live from `outputs` (no separate flag needed); ADVANCED has no
 * wire signal at all, so it's a small curated set here — flag for design
 * review if a second advanced action ever ships.
 */
import { useState } from 'react';
import {
  ClipboardList,
  FileEdit,
  FileInput,
  FilePlus,
  GitBranch,
  Globe,
  type LucideIcon,
  NotebookText,
  Plug,
  Search,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { ActionCatalogEntry } from '../contract';

const ACTION_ICONS: Record<string, LucideIcon> = {
  run_command: Terminal,
  'files.append': FilePlus,
  'files.write': FileEdit,
  'files.read': FileInput,
  'http.request': Globe,
  'github.create_pr': GitBranch,
  'github.list_prs': GitBranch,
  'notion.add_row': NotebookText,
  'ado.create_item': ClipboardList,
};

export interface ActionAccent {
  iconClass: string;
  tintClass: string;
  headerTintClass: string;
  headerBorderClass: string;
}

/**
 * Per-action accent (ts153 wf2-base.jsx `WF2_CATALOG`'s per-entry `color`,
 * restored here as a catalog-browsing distinctiveness cue). ts153 authors a
 * bespoke hex per action; this app's theme only ships a handful of accent
 * hues and no neutral-gray one (PARITY-NOTES: theme tokens govern colors,
 * never raw hex), so ids collapse into the nearest bucket — dark/near-black
 * ts153 colors (terminal gray, GitHub/Notion near-black) map to the
 * existing neutral tokens, teal-ish (files) to the green `kind-loop` token,
 * blue (http/Azure) to the blue `kind-call` token. Flagged for design review
 * if a richer palette lands.
 */
const NEUTRAL_ACCENT: ActionAccent = {
  iconClass: 'text-muted-foreground',
  tintClass: 'bg-muted',
  headerTintClass: 'bg-muted/50',
  headerBorderClass: 'border-border',
};
const LOOP_ACCENT: ActionAccent = {
  iconClass: 'text-mf-auto-kind-loop',
  tintClass: 'bg-mf-auto-kind-loop/12',
  headerTintClass: 'bg-mf-auto-kind-loop/[0.07]',
  headerBorderClass: 'border-mf-auto-kind-loop/20',
};
const CALL_ACCENT: ActionAccent = {
  iconClass: 'text-mf-auto-kind-call',
  tintClass: 'bg-mf-auto-kind-call/12',
  headerTintClass: 'bg-mf-auto-kind-call/[0.07]',
  headerBorderClass: 'border-mf-auto-kind-call/20',
};
const VIOLET_ACCENT: ActionAccent = {
  iconClass: 'text-mf-auto-violet',
  tintClass: 'bg-mf-auto-violet/12',
  headerTintClass: 'bg-mf-auto-violet/[0.07]',
  headerBorderClass: 'border-mf-auto-violet/20',
};

const ACTION_ACCENTS: Record<string, ActionAccent> = {
  run_command: NEUTRAL_ACCENT,
  'files.append': LOOP_ACCENT,
  'files.write': LOOP_ACCENT,
  'files.read': LOOP_ACCENT,
  'http.request': CALL_ACCENT,
  'github.create_pr': NEUTRAL_ACCENT,
  'github.list_prs': NEUTRAL_ACCENT,
  'notion.add_row': NEUTRAL_ACCENT,
  'ado.create_item': CALL_ACCENT,
};

/** Falls back to violet for ids outside the curated launch set (e.g. a future MCP entry). */
export function actionAccent(id: string): ActionAccent {
  return ACTION_ACCENTS[id] ?? VIOLET_ACCENT;
}

export function actionIcon(id: string): LucideIcon {
  return ACTION_ICONS[id] ?? Plug;
}

const ACTION_BLURBS: Record<string, string> = {
  run_command: 'Run a shell script; capture its output.',
  'files.append': 'Add text to the end of a file.',
  'files.write': 'Overwrite a file with new text.',
  'files.read': "Read a file's contents as a value.",
  'http.request': 'Call any HTTP endpoint.',
  'github.create_pr': 'Open a pull request on GitHub.',
  'github.list_prs': 'Get your open pull requests as a list.',
  'notion.add_row': 'Pick a database; its columns become fields.',
  'ado.create_item': 'File a work item in Azure DevOps.',
};

const ADVANCED_ACTION_IDS = new Set(['http.request']);

const GROUP_LABEL: Record<ActionCatalogEntry['group'], string> = {
  builtin: 'Built-in',
  connector: 'Connector',
  mcp: 'MCP',
};

const SOURCE_SEGMENTS: Array<{ id: 'all' | ActionCatalogEntry['group']; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'builtin', label: 'Built-in' },
  { id: 'connector', label: 'Connectors' },
  { id: 'mcp', label: 'MCP' },
];

export interface ActionCatalogProps {
  catalog: ActionCatalogEntry[];
  onPick: (action: ActionCatalogEntry) => void;
  testId: string;
}

export function ActionCatalog({ catalog, onPick, testId }: ActionCatalogProps) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | ActionCatalogEntry['group']>('all');

  const q = query.trim().toLowerCase();
  const shown = catalog.filter((a) => {
    if (source !== 'all' && a.group !== source) return false;
    if (!q) return true;
    const haystack = `${a.title} ${ACTION_BLURBS[a.id] ?? ''} ${a.credentialLabelHint ?? ''}`.toLowerCase();
    return haystack.includes(q);
  });

  return (
    <div data-testid={testId} className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-[10px] border-b-[0.5px] border-border p-[10px]">
        <div className="flex items-center gap-2 rounded-md border-[0.5px] border-border bg-card px-2.5 py-1.5">
          <Search size={14} className="text-muted-foreground" aria-hidden />
          <input
            data-testid={`${testId}-search`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions, connectors, MCP tools…"
            className="flex-1 border-none bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="inline-flex w-fit gap-0.5 rounded-md bg-muted p-0.5">
          {SOURCE_SEGMENTS.map((segment) => (
            <button
              key={segment.id}
              type="button"
              data-testid={`${testId}-filter-${segment.id}`}
              onClick={() => setSource(segment.id)}
              className={cn(
                'rounded-sm px-2.5 py-1 text-label font-medium',
                source === segment.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {segment.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-[10px]">
        {shown.map((action) => {
          const Icon = actionIcon(action.id);
          const accent = actionAccent(action.id);
          const isList = action.outputs.some((o) => o.type === 'list');
          const isAdvanced = ADVANCED_ACTION_IDS.has(action.id);
          return (
            <button
              key={action.id}
              type="button"
              data-testid={`${testId}-action-${action.id}`}
              onClick={() => onPick(action)}
              className="flex items-start gap-2.5 rounded-md border-[0.5px] border-border bg-card p-2.5 text-left hover:border-mf-border-hover hover:bg-accent"
            >
              <span
                className={cn('flex size-[30px] shrink-0 items-center justify-center rounded-md', accent.tintClass)}
              >
                <Icon size={16} className={accent.iconClass} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-body font-semibold text-foreground">{action.title}</span>
                  {isList && (
                    <Badge variant="outline" className="px-1.5 py-0 text-caption font-semibold leading-4">
                      LIST
                    </Badge>
                  )}
                  {isAdvanced && (
                    <Badge variant="outline" className="px-1.5 py-0 text-caption font-semibold leading-4">
                      ADVANCED
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-caption text-muted-foreground">{ACTION_BLURBS[action.id]}</span>
              </span>
              <span className="mt-0.5 shrink-0 text-caption text-muted-foreground">
                {action.credentialLabelHint ?? GROUP_LABEL[action.group]}
              </span>
            </button>
          );
        })}
        {shown.length === 0 && (
          <div className="p-[24px] text-center text-caption text-muted-foreground">No actions match “{query}”.</div>
        )}
      </div>
    </div>
  );
}
