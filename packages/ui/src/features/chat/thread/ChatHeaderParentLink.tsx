/**
 * "Forked from <title>" (or "Delegated by <title>" on a delegated child) —
 * the chat header's half of todo #343's shared lineage wording (see
 * `use-chat-header-parent-link.ts`). Renders nothing for a chat with no
 * parent or a draft (no `custom` to read a `parentChatId` from).
 */
import { LINEAGE_GLYPH } from '@/features/sessions/lineage-glyph';
import { cn } from '@/lib/utils';
import { useChatHeaderParentLink } from './use-chat-header-parent-link';

export function ChatHeaderParentLink() {
  const link = useChatHeaderParentLink();
  if (link == null) return null;
  const Glyph = LINEAGE_GLYPH[link.relation];

  return (
    <span
      data-testid="chat-header-parent-link"
      className={cn(
        'inline-flex min-w-0 shrink items-center gap-1 text-xs text-muted-foreground',
        link.onActivate != null && 'cursor-pointer hover:text-foreground',
      )}
      onClick={link.onActivate}
    >
      <Glyph aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{link.text}</span>
    </span>
  );
}
