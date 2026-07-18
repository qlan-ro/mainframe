/**
 * QuotaRing — a small progress ring for a window's used percentage. No ring
 * primitive existed before; the hole is punched with a radial mask so it reads
 * as a donut on any surface without matching the background. `unknown` renders
 * a dashed muted ring — the designed "quota unknown" glyph, never blank.
 */
import type { QuotaSeverity } from './quota-format';

const SEVERITY_COLOR: Record<QuotaSeverity, string> = {
  normal: 'var(--mf-success)',
  amber: 'var(--mf-warning)',
  red: 'var(--destructive)',
};

const DONUT_MASK = 'radial-gradient(circle, transparent 54%, #000 55%)';

export function QuotaRing({ usedPercent, severity }: { usedPercent: number; severity: QuotaSeverity }) {
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 rounded-full"
      style={{
        background: `conic-gradient(${SEVERITY_COLOR[severity]} ${usedPercent}%, var(--mf-chip) 0)`,
        WebkitMask: DONUT_MASK,
        mask: DONUT_MASK,
      }}
    />
  );
}

export function QuotaUnknownRing() {
  return <span aria-hidden className="size-4 shrink-0 rounded-full border-[1.5px] border-dashed border-mf-text-3" />;
}
