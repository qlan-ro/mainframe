/**
 * A ContextMenu copy item that reports its own outcome in place: the label
 * becomes "Copied" or "Copy failed" for as long as `useMenuCopyFeedback` keeps
 * the menu open, so a copy never confirms a write that did not land.
 *
 * Lives beside the hook that owns `CopyStatus`, because every copy menu in the
 * app pairs the two — the message path menu, the markdown link menu, and the
 * image menu would otherwise carry three copies of this markup.
 */
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { ContextMenuItem } from '@/components/ui/context-menu';
import type { CopyStatus } from '@/lib/ui/use-menu-copy-feedback';

export interface CopyMenuItemProps {
  testId: string;
  /** Shown while idle; the settled states replace it. */
  label: string;
  status: CopyStatus;
  onSelect: (event: Event) => void;
}

export function CopyMenuItem({ testId, label, status, onSelect }: CopyMenuItemProps) {
  return (
    <ContextMenuItem data-testid={testId} onSelect={onSelect}>
      {status === 'copied' && <Check className="mr-2 size-3.5 text-mf-success" />}
      {status === 'failed' && <AlertTriangle className="mr-2 size-3.5 text-destructive" />}
      {status === 'idle' && <Copy className="mr-2 size-3.5" />}
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : label}
    </ContextMenuItem>
  );
}
