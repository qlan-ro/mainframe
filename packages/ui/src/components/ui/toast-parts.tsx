/**
 * Pieces mfToast hands to sonner as slot elements: a 3-line clamped
 * description that reports overflow once, and the footer/close fragment.
 *
 * A valid element in sonner's `action` slot renders as-is (no sonner button,
 * no auto-dismiss), so every button here dismisses by id itself.
 */
import * as React from 'react';
import { XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function ClampedDescription({ text, onOverflow }: { text: string; onOverflow?: () => void }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const reported = React.useRef(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!onOverflow || reported.current || !el) return;
    if (el.scrollHeight > el.clientHeight) {
      reported.current = true;
      onOverflow();
    }
  });
  return (
    <span ref={ref} data-testid="toast-description" className="block line-clamp-3 break-words whitespace-pre-wrap">
      {text}
    </span>
  );
}

export interface ToastButton {
  label: string;
  onClick: () => void;
}

export function ToastControls({
  id,
  primary,
  details,
  closable,
}: {
  id: string;
  primary?: ToastButton;
  details?: ToastButton;
  closable: boolean;
}) {
  return (
    <>
      {closable && (
        <Button
          variant="ghost"
          size="icon-xs"
          data-testid="toast-close"
          data-toast-close=""
          aria-label="Dismiss"
          onClick={() => toast.dismiss(id)}
        >
          <XIcon />
        </Button>
      )}
      {(primary || details) && (
        <div data-toast-footer="" className="flex justify-end gap-1.5">
          {details && (
            <Button
              variant="ghost"
              size="xs"
              data-testid="toast-details"
              onClick={() => {
                details.onClick();
                toast.dismiss(id);
              }}
            >
              {details.label}
            </Button>
          )}
          {primary && (
            <Button
              size="xs"
              data-testid="toast-action"
              onClick={() => {
                primary.onClick();
                toast.dismiss(id);
              }}
            >
              {primary.label}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
