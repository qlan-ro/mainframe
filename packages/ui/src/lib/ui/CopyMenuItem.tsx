/**
 * A ContextMenu copy item that reports its own outcome in place: the label
 * becomes "Copied" or "Copy failed" for as long as `useMenuCopyFeedback` keeps
 * the menu open, so a copy never confirms a write that did not land.
 *
 * Lives beside the hook that owns `CopyStatus`, because every copy menu in the
 * app pairs the two — the message path menu, the markdown link menu, and the
 * image menu would otherwise carry three copies of this markup.
 */
import type { ComponentType, ReactNode } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { ContextMenuItem } from '@/components/ui/context-menu';
import type { CopyStatus } from '@/lib/ui/use-menu-copy-feedback';

export interface CopyMenuItemComponentProps {
  'data-testid'?: string;
  onSelect?: (event: Event) => void;
  children?: ReactNode;
}

export interface CopyMenuItemProps {
  testId: string;
  /** Shown while idle; the settled states replace it. */
  label: string;
  status: CopyStatus;
  onSelect: (event: Event) => void;
  /** The menu-item component to render into — `ContextMenuItem` by default,
   * so a `DropdownMenu` caller (the localhost chip) can pass `DropdownMenuItem`
   * and get the identical copy row instead of a second implementation. */
  as?: ComponentType<CopyMenuItemComponentProps>;
}

export function CopyMenuItem({ testId, label, status, onSelect, as: Item = ContextMenuItem }: CopyMenuItemProps) {
  return (
    // No sizing or margin on the icons: v2 ContextMenuItem/DropdownMenuItem
    // own both (gap-2 + the [&_svg] size rule).
    <Item data-testid={testId} onSelect={onSelect}>
      {status === 'copied' && <Check className="text-success" />}
      {status === 'failed' && <AlertTriangle className="text-destructive" />}
      {status === 'idle' && <Copy />}
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : label}
    </Item>
  );
}
