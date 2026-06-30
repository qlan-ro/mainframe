/**
 * SpotlightPalette — the ⌘O four-mode command palette.
 * Modes by prefix: (none) files+sessions · ">" commands · "@" symbols · "#" changes.
 * Open-state via useOverlaysStore.paletteOpen (set by the intent subscriber on
 * 'open-search-palette'). Custom engine (no cmdk): mode parsing + useListNavigation.
 */
import { useState } from 'react';
import { SearchIcon } from 'lucide-react';
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useOverlaysStore } from '@/store/overlays';
import { useListNavigation } from '@/lib/ui/use-list-navigation';
import { threadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { parseQuery, type ParsedQuery } from './palette-modes';
import { useSpotlightResults, type SpotlightRow } from './use-spotlight-results';
import { SpotlightRowView } from './SpotlightRow';

function sectionLabelFor(parsed: ParsedQuery): string {
  if (parsed.mode === 'cmd') return 'Commands';
  if (parsed.mode === 'sym') return 'Symbols';
  if (parsed.mode === 'chg') return 'Working tree';
  return parsed.term ? 'Results' : 'Sessions';
}

const FOOTER_HINTS = [
  ['↑↓', 'Navigate'],
  ['⏎', 'Open'],
  ['esc', 'Dismiss'],
] as const;

function PaletteField({
  parsed,
  query,
  onQueryChange,
  onKeyDown,
}: {
  parsed: ParsedQuery;
  query: string;
  onQueryChange: (v: string) => void;
  onKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <div className="flex h-[54px] shrink-0 items-center gap-[11px] border-b border-border px-[16px]">
      <SearchIcon className="size-4 shrink-0 text-mf-text-3" />
      {parsed.chip && (
        <span
          data-testid="search-palette-mode-chip"
          className="inline-flex h-[22px] shrink-0 items-center rounded-[6px] bg-primary/10 px-[9px] text-caption font-bold text-primary"
        >
          {parsed.chip}
        </span>
      )}
      <input
        autoFocus
        data-noring=""
        data-testid="search-palette-input"
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={parsed.placeholder}
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-heading tracking-tight text-foreground outline-none placeholder:text-mf-text-3"
      />
      <kbd className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[6px] bg-mf-chip px-[6px] text-caption font-semibold text-mf-text-3">
        esc
      </kbd>
    </div>
  );
}

function PaletteResults({
  rows,
  loading,
  sectionLabel,
  activeIndex,
  rowRefs,
  onSelect,
}: {
  rows: SpotlightRow[];
  loading: boolean;
  sectionLabel: string;
  activeIndex: number;
  rowRefs: React.MutableRefObject<(HTMLElement | null)[]>;
  onSelect: (row: SpotlightRow) => void;
}) {
  return (
    <div role="listbox" className="flex-1 overflow-y-auto overflow-x-hidden p-[6px]">
      <div className="px-[10px] pb-[4px] pt-[6px] text-micro font-bold uppercase tracking-wide text-mf-text-3">
        {sectionLabel}
      </div>
      {rows.length === 0 && !loading && (
        <div data-testid="search-palette-empty" className="px-[10px] py-[26px] text-center text-body text-mf-text-3">
          No matches
        </div>
      )}
      {rows.map((row, i) => (
        <SpotlightRowView
          key={row.id}
          row={row}
          isActive={i === activeIndex}
          rowRef={(el) => {
            rowRefs.current[i] = el;
          }}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function PaletteFooter() {
  return (
    <div
      data-testid="search-palette-footer"
      className="flex h-[34px] shrink-0 items-center gap-[16px] border-t border-border bg-mf-content2 px-[14px]"
    >
      {FOOTER_HINTS.map(([k, l]) => (
        <span key={l} className="inline-flex items-center gap-[5px]">
          <kbd className="inline-flex h-4 items-center rounded-[4px] bg-mf-chip px-[5px] text-micro font-semibold text-mf-text-3">
            {k}
          </kbd>
          <span className="text-caption text-mf-text-3">{l}</span>
        </span>
      ))}
    </div>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const parsed = parseQuery(query);

  const runtime = useAssistantRuntime();
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const sessions = threadItemsToSessionItems(threadItems);
  const port = useDaemonPort();
  const { projectId, projectPath, chatId } = useActiveIdentity();

  const { rows, loading } = useSpotlightResults({
    parsed,
    port,
    projectId,
    projectPath,
    chatId,
    sessions,
    switchToThread: (id) => runtime.threads.switchToThread(id),
  });

  const confirm = (row: SpotlightRow) => {
    row.run();
    onClose();
  };
  const { activeIndex, handleKeyDown, rowRefs } = useListNavigation(rows.length, (i) => {
    const row = rows[i];
    if (row) confirm(row);
  });

  const sectionLabel = sectionLabelFor(parsed);

  return (
    <div className="flex flex-col overflow-hidden">
      <PaletteField parsed={parsed} query={query} onQueryChange={setQuery} onKeyDown={handleKeyDown} />
      <PaletteResults
        rows={rows}
        loading={loading}
        sectionLabel={sectionLabel}
        activeIndex={activeIndex}
        rowRefs={rowRefs}
        onSelect={confirm}
      />
      <PaletteFooter />
    </div>
  );
}

export function SpotlightPalette() {
  const open = useOverlaysStore((s) => s.paletteOpen);
  const setPaletteOpen = useOverlaysStore((s) => s.setPaletteOpen);
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && setPaletteOpen(false)}>
      <DialogContent
        data-testid="search-palette"
        hideClose
        aria-describedby={undefined}
        className="top-[11vh] w-[580px] max-w-[90vw] translate-y-0 gap-0 overflow-hidden rounded-[13px] border-0 p-0 shadow-[var(--mf-shadow-modal)] max-h-[62vh]"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <PaletteBody onClose={() => setPaletteOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
