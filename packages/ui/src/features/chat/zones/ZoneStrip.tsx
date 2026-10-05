/**
 * ZoneStrip — the 28px row over one zone of a visible split: the zone's
 * fork-parent link (it reads `threadListItem` through the zone's rebound
 * provider, so it cannot live in shell chrome), and the
 * zone close ✕. It renders ONLY while the split is on screen — the single
 * view has no chat header at all; those controls sit in the title bar.
 */
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { ChatHeaderParentLink } from '../thread/ChatHeaderParentLink';

export function ZoneStrip({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  return (
    <div data-testid={`chat-zone-strip-${chatId}`} className="flex h-7 shrink-0 items-center gap-1 pr-1 pl-2">
      <ChatHeaderParentLink />
      <span className="flex-1" />
      <Hint label="Close zone">
        <Button
          data-testid={`chat-zone-close-${chatId}`}
          variant="ghost"
          size="icon-xs"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X className="text-muted-foreground" />
        </Button>
      </Hint>
    </div>
  );
}
