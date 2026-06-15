/**
 * SearchPalette — Cmd+O global command palette.
 *
 * Two groups:
 *  - Sessions: all threads mapped from the aui thread list, switch on select.
 *  - Files: server-driven debounced search (≥2 chars), emit open-file on select.
 *
 * Open-state is driven by useOverlaysStore.paletteOpen (set by the intent
 * subscriber on 'open-search-palette'). cmdk's built-in filter is bypassed for
 * the Files group (shouldFilter=false) because results are server-driven. The
 * Sessions group is always visible regardless of query.
 */
import { useState } from 'react';
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import { FileIcon, MessageSquareIcon } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useOverlaysStore } from '@/store/overlays';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useFileSearch, dirOf } from '@/features/files/use-file-search';
import { threadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';

export function SearchPalette() {
  const open = useOverlaysStore((s) => s.paletteOpen);
  const setPaletteOpen = useOverlaysStore((s) => s.setPaletteOpen);
  const [query, setQuery] = useState('');

  const runtime = useAssistantRuntime();
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const sessions = threadItemsToSessionItems(threadItems);

  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();
  const { results: fileResults } = useFileSearch(port, projectId, chatId, query);

  function close() {
    setPaletteOpen(false);
    setQuery('');
  }

  function onSelectSession(remoteId: string) {
    runtime.threads.switchToThread(remoteId);
    emitSurfaceIntent({ type: 'activate-surface', surface: 'chat' });
    close();
  }

  function onSelectFile(path: string) {
    emitSurfaceIntent({ type: 'open-file', path });
    close();
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <CommandInput
        data-testid="search-palette-input"
        placeholder="Search sessions and files..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {sessions.length > 0 && (
          <CommandGroup heading="Sessions">
            {sessions.map((session) => (
              <CommandItem
                key={session.id}
                data-testid={`search-palette-session-row-${session.remoteId ?? session.id}`}
                onSelect={() => onSelectSession(session.remoteId ?? session.id)}
                value={`session-${session.remoteId ?? session.id}-${session.title ?? ''}`}
              >
                <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{session.title ?? 'Untitled'}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sessions.length > 0 && query.trim().length >= 2 && fileResults.length > 0 && <CommandSeparator />}

        {query.trim().length >= 2 && (
          <CommandGroup heading="Files">
            {fileResults.map((result) => (
              <CommandItem
                key={result.path}
                data-testid={`search-palette-file-row-${result.path}`}
                onSelect={() => onSelectFile(result.path)}
                value={`file-${result.path}`}
              >
                <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{result.name}</span>
                <span className="ml-auto truncate text-caption text-muted-foreground">{dirOf(result.path)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {query.trim().length >= 2 && fileResults.length === 0 && <CommandEmpty>No matches</CommandEmpty>}
      </CommandList>
    </CommandDialog>
  );
}
