import { forwardRef, useId } from 'react';
import { createLucideIcon, type LucideProps } from 'lucide-react';

const Outline = createLucideIcon('bot-filled', [
  ['path', { d: 'M12 8V4H8', key: 'antenna' }],
  ['path', { d: 'M2 14h2', key: 'ear-left' }],
  ['path', { d: 'M20 14h2', key: 'ear-right' }],
]);

/** Lucide's `Bot` with a filled face: a delegated task, beside the outlined sub-agent. */
export const BotFilled = forwardRef<SVGSVGElement, LucideProps>(function BotFilled(props, ref) {
  const mask = useId();
  return (
    <Outline ref={ref} {...props}>
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path d="M15 13v2M9 13v2" stroke="black" strokeWidth="2.4" />
      </mask>
      <rect x="4" y="8" width="16" height="12" rx="2" fill="currentColor" mask={`url(#${mask})`} />
    </Outline>
  );
});
