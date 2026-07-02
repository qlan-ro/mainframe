/**
 * Chrome glyphs — exact ports of the warm-chrome prototype icons
 * (01-base.jsx Icon: viewBox 0 0 18 18, stroke 1.6, round caps/joins). Used by
 * the SurfaceRail / SurfaceTabStrip / ChatHeader / SidebarHeader so the
 * iconography matches the design rather than lucide's lookalikes (notably the
 * FILLED play and the GEAR settings glyph vs lucide's sliders).
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

function StrokeGlyph({ size, className, children }: GlyphProps & { children: React.ReactNode }) {
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
      {children}
    </svg>
  );
}

/** Tasks — checklist box (prototype 'checklist.box'). */
export function TasksGlyph({ size = 14, className }: GlyphProps) {
  return (
    <StrokeGlyph size={size} className={className}>
      <rect x="3" y="3" width="12" height="12" rx="3" />
      <path d="M6.2 9.2 8.2 11.2 12 6.8" />
    </StrokeGlyph>
  );
}

/** Settings — gear (prototype 'gear'; the path is authored at 24u, scaled to 18). */
export function GearGlyph({ size = 15, className }: GlyphProps) {
  return (
    <StrokeGlyph size={size} className={className}>
      <g transform="scale(0.75)">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </g>
    </StrokeGlyph>
  );
}

/** Hide sidebar — panel with a left rail (prototype 'sidebar.left'). */
export function SidebarLeftGlyph({ size = 14, className }: GlyphProps) {
  return (
    <StrokeGlyph size={size} className={className}>
      <rect x="2.5" y="3.5" width="13" height="11" rx="2" />
      <path d="M7 3.5v11" />
    </StrokeGlyph>
  );
}

/** Inspector toggle — panel with a right rail (prototype `sidebar.right`; mirror of SidebarLeftGlyph). */
export function SidebarRightGlyph({ size = 14, className }: GlyphProps) {
  return (
    <StrokeGlyph size={size} className={className}>
      <rect x="2.5" y="3.5" width="13" height="11" rx="2" />
      <path d="M11 3.5v11" />
    </StrokeGlyph>
  );
}
