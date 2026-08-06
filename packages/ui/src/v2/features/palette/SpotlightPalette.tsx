/**
 * The ⌘O four-mode command palette, on the stock cmdk engine.
 * Modes by prefix: (none) files+sessions · ">" commands · "@" symbols · "#" changes.
 *
 * All result computation stays in the shared `useSpotlightResults`
 * (imported, not cloned) — the daemon does the matching, so cmdk runs with
 * `shouldFilter={false}` and only contributes the input, listbox semantics and
 * keyboard navigation the v1 version hand-rolled.
 */
import { useEffect, useState } from 'react';
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import { Badge } from '@v2/components/ui/badge';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from '@v2/components/ui/command';
import { InputGroupAddon } from '@v2/components/ui/input-group';
import { useOverlaysStore } from '@/store/overlays';
import { threadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { parseQuery, type ParsedQuery } from '@/features/palette/palette-modes';
import { useSpotlightResults, type SpotlightRow } from '@/features/palette/use-spotlight-results';
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

function PaletteFooter() {
  return (
    <div data-testid="search-palette-footer" className="flex h-8 shrink-0 items-center gap-4 border-t px-3">
      {FOOTER_HINTS.map(([k, l]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <kbd className="rounded-sm bg-muted px-1 text-xs font-medium text-muted-foreground">{k}</kbd>
          <span className="text-xs text-muted-foreground">{l}</span>
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

  // Controlled selection: rows land async, after cmdk's own
  // select-first-on-search tick (see FilePickerDialog).
  const [selected, setSelected] = useState('');
  useEffect(() => {
    if (rows.length > 0 && !rows.some((r) => r.id === selected)) setSelected(rows[0]!.id);
  }, [rows, selected]);

  const confirm = (row: SpotlightRow) => {
    row.run();
    onClose();
  };

  return (
    <Command shouldFilter={false} value={selected} onValueChange={setSelected} data-testid="search-palette">
      <CommandInput
        autoFocus
        data-testid="search-palette-input"
        value={query}
        onValueChange={setQuery}
        placeholder={parsed.placeholder}
      >
        {parsed.chip && (
          <InputGroupAddon>
            <Badge
              data-testid="search-palette-mode-chip"
              variant="secondary"
              className="px-1.5 py-0 text-xs text-primary"
            >
              {parsed.chip}
            </Badge>
          </InputGroupAddon>
        )}
      </CommandInput>
      <CommandList className="max-h-[50vh]">
        <CommandEmpty data-testid={loading ? 'search-palette-loading' : 'search-palette-empty'}>
          {loading ? 'Searching…' : 'No matches'}
        </CommandEmpty>
        <CommandGroup heading={sectionLabelFor(parsed)}>
          {rows.map((row) => (
            <SpotlightRowView key={row.id} row={row} onSelect={confirm} />
          ))}
        </CommandGroup>
      </CommandList>
      <PaletteFooter />
    </Command>
  );
}

export function SpotlightPalette() {
  const open = useOverlaysStore((s) => s.paletteOpen);
  const setPaletteOpen = useOverlaysStore((s) => s.setPaletteOpen);

  // Rendered closed rather than early-returning null — the Radix
  // pointer-events leak (see the v2-stock dialog ledger). The body still
  // unmounts with the closed content, so query state resets per open.
  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPaletteOpen(false);
      }}
      title="Command palette"
      description="Search files, sessions, symbols and commands"
      className="sm:max-w-xl"
    >
      <PaletteBody onClose={() => setPaletteOpen(false)} />
    </CommandDialog>
  );
}
