/**
 * ActionCatalog — searchable, source-segmented action picker (ts153
 * wf2-stepconfig.jsx `WfActionCatalog`, ported onto contract action ids and
 * embedded directly in `ActionConfig` rather than a separate modal —
 * `StepCard`'s own "Set up" disclosure is already the containing chrome).
 *
 * `ActionCatalogEntry` carries no icon/color/blurb/advanced-flag (contract
 * §1 keeps it thin: id/title/group/auth/credentialLabelHint/paramsSchema/
 * outputs) — `ACTION_VISUALS` is this component's UI-local presentation
 * table, the same pattern `domain/tokens.ts`'s `ACTION_LIST_ITEM_FIELDS`
 * already uses. LIST is derived live from `outputs` (no separate flag
 * needed); ADVANCED has no wire signal at all, so it's a small curated set
 * here — flag for design review if a second advanced action ever ships.
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
    <div data-testid={testId} className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 rounded-md border-[0.5px] border-border bg-card px-2.5 py-1.5">
        <Search size={13} className="text-muted-foreground" aria-hidden />
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
      <div className="flex flex-col gap-1.5">
        {shown.map((action) => {
          const Icon = ACTION_ICONS[action.id] ?? Plug;
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
              <span className="flex size-[30px] shrink-0 items-center justify-center rounded-md bg-mf-wf-violet/12">
                <Icon size={15} className="text-mf-wf-violet" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-body font-semibold text-foreground">{action.title}</span>
                  {isList && (
                    <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-bold leading-4">
                      LIST
                    </Badge>
                  )}
                  {isAdvanced && (
                    <Badge variant="outline" className="px-1.5 py-0 text-[9px] font-bold leading-4">
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
          <div className="p-4 text-center text-caption text-muted-foreground">No actions match "{query}".</div>
        )}
      </div>
    </div>
  );
}
