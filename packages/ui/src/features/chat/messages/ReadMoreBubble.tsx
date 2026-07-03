/**
 * ReadMoreBubble — wraps user-message content with a WhatsApp-style
 * "Read more / Show less" clamp when the rendered text exceeds the threshold.
 *
 * Thin wrapper around the shared `ReadMore` primitive: extracts the plain-text
 * measurement source via `extractText` (features-only concern; `ReadMore`
 * itself stays a passthrough `ui/` primitive with no `features/` import) and
 * fixes the tuning/testid to match the desktop user-bubble design.
 *
 * Keep-ours per the assistant-ui inventory (there is no native truncation gate).
 */
import type { ReactNode } from 'react';
import { ReadMore } from '@/components/ui/read-more';
import { extractText } from '../parts/extract-text';

export interface ReadMoreBubbleProps {
  children: ReactNode;
  className?: string;
}

/**
 * Clamps long message content behind a "Read more" button.
 *
 * The fade overlay sits above the last visible line and uses
 * `--mf-um-fade` (the solid end-stop of the card gradient) so the
 * transition looks seamless on both light and dark skins.
 */
export function ReadMoreBubble({ children, className }: ReadMoreBubbleProps) {
  return (
    <ReadMore
      measureText={extractText(children)}
      threshold={600}
      clampLines={4}
      fadeColor="var(--mf-um-fade)"
      fadeOffsetClass="bottom-6"
      contentClassName="aui-md text-body leading-loose tracking-tight"
      className={className}
      testId="chat-user-readmore-toggle"
    >
      {children}
    </ReadMore>
  );
}
