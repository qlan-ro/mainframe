/**
 * Proves the type claim: the shipped scale spends half its rungs inside a 3px
 * band, so choosing between them is a decision with no visual consequence.
 */
import { useMeasured } from './use-measured';

interface Rung {
  name: string;
  cls: string;
  shipped: number | null;
  use: string;
}

const RUNGS: Rung[] = [
  { name: 'caption', cls: 'text-caption', shipped: 11, use: 'Timestamps, counts, uppercase group headers' },
  { name: 'body', cls: 'text-body', shipped: 13, use: 'Controls, field labels, list rows — the default' },
  { name: 'heading', cls: 'text-heading', shipped: 15, use: 'Section titles' },
  { name: 'title', cls: 'text-title', shipped: 17, use: 'Panel and page titles' },
  { name: 'display', cls: 'text-display', shipped: 22, use: 'Empty states' },
  { name: 'hero', cls: 'text-hero', shipped: 28, use: 'Onboarding' },
];

const DELETED = [
  { name: 'micro', size: 10, note: '1px from caption — folded into it' },
  { name: 'label', size: 12, note: 'folded into body; label-vs-value is now weight + colour' },
];

function gapPercent(smaller: number | undefined, larger: number | undefined): string {
  if (!smaller || !larger) return '—';
  return `+${Math.round(((larger - smaller) / smaller) * 100)}%`;
}

export function TypeScale() {
  const { hostRef, measured } = useMeasured('fontSize');

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-heading font-semibold text-foreground">Type</h2>
        <p className="max-w-[70ch] text-caption text-muted-foreground">
          Eight rungs down to six. The shipped scale put micro 10 · caption 11 · label 12 · body 13 inside three pixels;
          every v2 rung is at least 14% from its neighbour.
        </p>
      </header>

      <div ref={hostRef} className="flex max-w-[720px] flex-col">
        {RUNGS.map((r, i) => (
          <div key={r.name} className="flex items-baseline gap-4 border-b border-border/50 py-2.5">
            <span className="w-[72px] shrink-0 font-mono text-caption text-muted-foreground">{r.name}</span>
            <span className="w-[96px] shrink-0 font-mono text-caption text-muted-foreground">
              {r.shipped}px → <span className="text-foreground">{measured[r.name]}px</span>
            </span>
            <span className="w-[52px] shrink-0 font-mono text-caption text-mf-text-3">
              {gapPercent(measured[RUNGS[i - 1]?.name ?? ''], measured[r.name])}
            </span>
            <span data-probe={r.name} className={`${r.cls} truncate text-foreground`}>
              {r.use}
            </span>
          </div>
        ))}
      </div>

      <div className="flex max-w-[720px] flex-col gap-1.5 rounded-md border border-border bg-muted p-3">
        <span className="text-caption font-semibold text-foreground">Deleted — 356 sites to port</span>
        {DELETED.map((d) => (
          <p key={d.name} className="text-caption text-muted-foreground">
            <code className="font-mono text-foreground">text-{d.name}</code> ({d.size}px) — {d.note}
          </p>
        ))}
        <p className="mt-1 text-caption text-muted-foreground">
          An undefined font-size class is inert, not an error: it renders at the inherited size. That's why these are
          deleted rather than remapped, and why the v2 lint greps for them.
        </p>
      </div>
    </section>
  );
}
