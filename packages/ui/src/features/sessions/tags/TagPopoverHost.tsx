/**
 * TagPopoverHost — single mounted host for the session Tag popover.
 *
 * Reads the open target (use-tag-popover-target), resolves the registry and a
 * snapshot of the live thread list, and renders the controlled TagPopover.
 *
 * onCascade (rename/delete only — recolor is registry-only inside TagPopover):
 * apply setChatTags(port, id, newTags) for each affected thread, then reload the
 * native list so derived custom re-syncs from the daemon (server-authoritative).
 */
import { useMemo } from 'react';
import { useAuiState, useAssistantRuntime } from '@assistant-ui/react';
import { setChatTags } from '../../../lib/api/tags';
import { threadItemsToSessionItems } from '../view-model/chat-to-thread-custom';
import type { TagCascadeUpdate } from './build-tag-cascade';
import { useTagRegistry } from './use-tag-registry';
import { useTagPopoverTarget } from './use-tag-popover-target';
import { TagPopover } from './TagPopover';

export function TagPopoverHost({ port }: { port: number }) {
  const target = useTagPopoverTarget((s) => s.target);
  const close = useTagPopoverTarget((s) => s.close);
  const registry = useTagRegistry(port);
  const runtime = useAssistantRuntime();
  // Select the stable store-scope threadItems array; project outside the selector
  // so the fresh array does not loop useAuiState's Object.is comparison.
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const items = useMemo(() => threadItemsToSessionItems(threadItems), [threadItems]);

  const threads = items.map((t) => ({ id: t.id, custom: { tags: t.custom.tags } }));

  // Read the applied tags LIVE from the thread list (server-authoritative), not the
  // frozen snapshot captured when the popover opened — otherwise toggling a tag calls
  // setChatTags + reload but the checkbox state never updates (can't check/uncheck).
  // SessionRow opens with chatId = remoteId ?? id, so match on either.
  const currentTags = useMemo(() => {
    if (!target) return [];
    const match = items.find((t) => (t.remoteId ?? t.id) === target.chatId || t.id === target.chatId);
    return match?.custom.tags ?? target.currentTags;
  }, [items, target]);

  async function applyCascade(updates: TagCascadeUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    for (const u of updates) {
      await setChatTags(port, u.id, u.newTags);
    }
    await runtime.threads.reload();
  }

  return (
    <TagPopover
      open={target != null}
      onClose={close}
      chatId={target?.chatId ?? ''}
      port={port}
      currentTags={currentTags}
      anchorRect={target?.anchorRect ?? null}
      registry={registry}
      threads={threads}
      onCascade={(updates) => void applyCascade(updates)}
      onReload={() => void runtime.threads.reload()}
    />
  );
}
