/**
 * Surface glyphs — exact ports of the warm-chrome prototype icons
 * (01-base.jsx Icon: viewBox 0 0 18 18, stroke 1.6, round caps/joins). Used by
 * the SurfaceRail / SurfaceTabStrip / ChatHeader so the Chat·Editor·Preview
 * iconography matches the design rather than lucide's lookalikes (notably the
 * FILLED play vs lucide's outline).
 *
 * Color comes from the `className` (text-* / currentColor), matching lucide's
 * API so call sites are drop-in.
 */
interface GlyphProps {
  size?: number;
  className?: string;
}

const STROKE = 1.6;

export function ChatGlyph({ size = 12, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H7.5L4.5 15v-3z" />
    </svg>
  );
}

export function EditorGlyph({ size = 12, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4.5 2.5h6l3 3V15a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" />
      <path d="M10.5 2.5V5.5h3M6 8.5h6M6 10.5h6M6 12.5h4" />
    </svg>
  );
}

export function PreviewGlyph({ size = 12, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="currentColor"
      stroke="none"
      className={className}
      aria-hidden
    >
      <path d="M5 3.5v11l9-5.5z" />
    </svg>
  );
}
