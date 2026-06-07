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
import { useAuiState, useAssistantRuntime } from '@assistant-ui/react';
import { setChatTags } from '../../../lib/api/tags';
import type { TagCascadeUpdate } from './build-tag-cascade';
import { useTagRegistry } from './use-tag-registry';
import { useTagPopoverTarget } from './use-tag-popover-target';
import { TagPopover } from './TagPopover';

interface ThreadSnapshot {
  id: string;
  remoteId?: string;
  custom?: { tags?: string[] };
}

export function TagPopoverHost({ port }: { port: number }) {
  const target = useTagPopoverTarget((s) => s.target);
  const close = useTagPopoverTarget((s) => s.close);
  const registry = useTagRegistry(port);
  const runtime = useAssistantRuntime();
  const items = useAuiState((s) => s.threads.threadItems as unknown as ThreadSnapshot[]);

  const threads = items.map((t) => ({ id: t.id, custom: { tags: t.custom?.tags ?? [] } }));

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
      currentTags={target?.currentTags ?? []}
      registry={registry}
      threads={threads}
      onCascade={(updates) => void applyCascade(updates)}
    />
  );
}
