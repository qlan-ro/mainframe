/**
 * The one mounted tag popover, for whichever session row asked for it.
 *
 * Rows publish a target to a store instead of rendering their own popover — a
 * windowed list unmounts the row under the open popover as soon as it scrolls.
 *
 * Applied tags are read live from the thread list rather than from the snapshot
 * the row published: toggling writes to the daemon and reloads, and a frozen
 * snapshot would leave every checkbox stuck where it opened.
 */
import { useMemo } from 'react';
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import { setChatTags } from '@/lib/api/tags';
import { threadItemsToSessionItems } from '@/features/sessions/view-model/chat-to-thread-custom';
import type { TagCascadeUpdate } from '@/features/sessions/tags/build-tag-cascade';
import { useTagPopoverTarget } from '@/features/sessions/tags/use-tag-popover-target';
import { useTagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { TagPopover } from './TagPopover';

export function TagPopoverHost({ port }: { port: number }) {
  const target = useTagPopoverTarget((s) => s.target);
  const close = useTagPopoverTarget((s) => s.close);
  const registry = useTagRegistry(port);
  const runtime = useAssistantRuntime();

  // Project outside the selector — a fresh array inside it would loop useAuiState's Object.is.
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const items = useMemo(() => threadItemsToSessionItems(threadItems), [threadItems]);

  const threads = useMemo(() => items.map((item) => ({ id: item.id, custom: { tags: item.custom.tags } })), [items]);

  // Rows open with `remoteId ?? id`, so match on either.
  const currentTags = useMemo(() => {
    if (target === null) return [];
    const match = items.find((item) => (item.remoteId ?? item.id) === target.chatId || item.id === target.chatId);
    return match?.custom.tags ?? target.currentTags;
  }, [items, target]);

  async function applyCascade(updates: TagCascadeUpdate[]): Promise<void> {
    for (const update of updates) {
      await setChatTags(port, update.id, update.newTags);
    }
    await runtime.threads.reload();
  }

  return (
    <TagPopover
      open={target !== null}
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
