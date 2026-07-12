/**
 * AddStepMenu — the four verbs + two blocks pinned on top (ts153 wf2-editor.
 * jsx `WfAddMenu`), plus a searchable action catalog below it: picking a
 * catalog entry directly adds a `run_action` step with `actionId` already
 * set (skipping the "Pick an action" empty state) — an enhancement over
 * ts153, which had no action catalog to search yet. Hidden entirely while
 * the catalog is empty (Phase 4 populates it; the fixture gateway ships
 * empty on purpose).
 */
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ActionCatalogEntry, AutomationStep } from '../contract';
import { ADD_STEP_GROUPS, VERB_META } from './verb-meta';

export interface AddStepMenuProps {
  catalog: ActionCatalogEntry[];
  onAdd: (kind: AutomationStep['kind']) => void;
  onAddAction: (actionId: string) => void;
  testId: string;
}

export function AddStepMenu({ catalog, onAdd, onAddAction, testId }: AddStepMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = catalog.filter((a) => a.title.toLowerCase().includes(query.trim().toLowerCase()));

  function pick(kind: AutomationStep['kind']) {
    onAdd(kind);
    setOpen(false);
    setQuery('');
  }

  function pickAction(actionId: string) {
    onAddAction(actionId);
    setOpen(false);
    setQuery('');
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          className="inline-flex h-[30px] items-center gap-1.5 self-start rounded-md border border-dashed border-border px-3 text-caption font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus size={12} aria-hidden />
          Add step
        </button>
      </PopoverTrigger>
      <PopoverContent data-testid={`${testId}-menu`} align="start" className="max-h-96 w-72 overflow-y-auto p-1.5">
        {ADD_STEP_GROUPS.map((group) => (
          <div key={group.label} className="mb-1">
            <div className="px-2 py-1 text-caption font-medium text-muted-foreground">{group.label}</div>
            {group.kinds.map((kind) => {
              const meta = VERB_META[kind];
              const Icon = meta.icon;
              return (
                <button
                  key={kind}
                  type="button"
                  data-testid={`${testId}-verb-${kind}`}
                  onClick={() => pick(kind)}
                  className="flex w-full items-start gap-2.5 rounded-md p-2 text-left hover:bg-accent"
                >
                  <span
                    className={cn('flex size-[26px] shrink-0 items-center justify-center rounded-md', meta.tintClass)}
                  >
                    <Icon size={14} className={meta.iconClass} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-label font-semibold text-foreground">{meta.label}</span>
                    <span className="mt-0.5 block text-caption text-muted-foreground">{meta.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {catalog.length > 0 && (
          <div className="mt-1 border-t border-border pt-1.5">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <Search size={11} className="text-muted-foreground" aria-hidden />
              <input
                data-testid={`${testId}-search`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search actions…"
                className="w-full border-none bg-transparent text-caption text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
            {filtered.map((action) => (
              <button
                key={action.id}
                type="button"
                data-testid={`${testId}-action-${action.id}`}
                onClick={() => pickAction(action.id)}
                className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate text-label text-foreground">{action.title}</span>
                <span className="text-caption text-muted-foreground">{action.group}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-2 text-caption text-muted-foreground">No actions match “{query}”.</div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
