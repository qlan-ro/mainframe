/**
 * A small progress ring for a window's used percentage. The hole is punched with
 * a radial mask so it reads as a donut on any surface without matching the
 * background. `unknown` renders a dashed muted ring — the designed "quota
 * unknown" glyph, never blank.
 *
 * The shipped version tints green/amber/red; the preset has no amber, so the
 * warning band collapses into `primary` and only the red band stands out.
 */
import type { QuotaSeverity } from '@/features/quota/quota-format';

const SEVERITY_FILL: Record<QuotaSeverity, string> = {
  normal: 'var(--primary)',
  amber: 'var(--primary)',
  red: 'var(--destructive)',
};

// Mask gradients key off alpha, not hue — `black` is a full-opacity stop here,
// not a colour.
const DONUT_MASK = 'radial-gradient(circle, transparent 54%, black 55%)';

export function QuotaRing({
  usedPercent,
  severity,
  muted = false,
}: {
  usedPercent: number;
  severity: QuotaSeverity;
  /** Quiet placement (the session rail): normal/amber fill drops to the muted
   *  ink; red still alarms — danger never goes quiet. */
  muted?: boolean;
}) {
  const fill = muted && severity !== 'red' ? 'var(--muted-foreground)' : SEVERITY_FILL[severity];
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 rounded-full"
      style={{
        background: `conic-gradient(${fill} ${usedPercent}%, var(--muted) 0)`,
        WebkitMask: DONUT_MASK,
        mask: DONUT_MASK,
      }}
    />
  );
}

export function QuotaUnknownRing() {
  return (
    <span aria-hidden className="size-4 shrink-0 rounded-full border-[1.5px] border-dashed border-muted-foreground" />
  );
}
