/**
 * Proves the spacing claim: shipped is non-monotonic, v2 is not.
 *
 * The v2 column is measured live. The shipped column is the arithmetic the
 * shipped theme produces — overridden integers from its --spacing-1..12 block,
 * stock 0.25rem fractionals — and can't be measured here because this page only
 * ever loads one of the two token sets.
 */
import { useMeasured } from './use-measured';

interface Step {
  step: string;
  cls: string;
  shipped: number;
}

/** Interleaved so the integer/fractional collision is adjacent, not implied. */
const STEPS: Step[] = [
  { step: '0.5', cls: 'pl-0.5', shipped: 2 },
  { step: '1', cls: 'pl-1', shipped: 2 },
  { step: '1.5', cls: 'pl-1.5', shipped: 6 },
  { step: '2', cls: 'pl-2', shipped: 4 },
  { step: '2.5', cls: 'pl-2.5', shipped: 10 },
  { step: '3', cls: 'pl-3', shipped: 6 },
  { step: '3.5', cls: 'pl-3.5', shipped: 14 },
  { step: '4', cls: 'pl-4', shipped: 8 },
  { step: '5', cls: 'pl-5', shipped: 12 },
  { step: '6', cls: 'pl-6', shipped: 16 },
  { step: '8', cls: 'pl-8', shipped: 24 },
  { step: '10', cls: 'pl-10', shipped: 40 },
  { step: '12', cls: 'pl-12', shipped: 64 },
];

function regressions(values: number[]): Set<number> {
  const bad = new Set<number>();
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const here = values[i];
    if (prev !== undefined && here !== undefined && here < prev) bad.add(i);
  }
  return bad;
}

export function SpacingScale() {
  const { hostRef, measured } = useMeasured('paddingLeft');

  const shippedBad = regressions(STEPS.map((s) => s.shipped));
  const v2Values = STEPS.map((s) => measured[s.step] ?? 0);
  const v2Bad = regressions(v2Values);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-heading font-semibold text-foreground">Spacing</h2>
        <p className="max-w-[70ch] text-caption text-muted-foreground">
          Each row is one step up from the row above it. A red cell is a step that goes <em>down</em> — the reason 718
          arbitrary <code className="font-mono">[Npx]</code> spacing utilities exist in the shipped app.
        </p>
      </header>

      {/* Probes are measured, never shown: the visible bars are sized from the
          measurement so a bar can't disagree with its own number. */}
      <div ref={hostRef} className="sr-only" aria-hidden>
        {STEPS.map((s) => (
          <div key={s.step} data-probe={s.step} className={s.cls} />
        ))}
      </div>

      <table className="w-full max-w-[640px] border-collapse text-caption">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="w-[64px] py-1.5 font-medium">Step</th>
            <th className="w-[88px] py-1.5 font-medium">Shipped</th>
            <th className="w-[88px] py-1.5 font-medium">v2</th>
            <th className="py-1.5 font-medium">v2 to scale</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {STEPS.map((s, i) => (
            <tr key={s.step} className="border-b border-border/50">
              <td className="py-1 text-muted-foreground">{s.step}</td>
              <td className={shippedBad.has(i) ? 'py-1 font-semibold text-destructive' : 'py-1 text-foreground'}>
                {s.shipped}px
              </td>
              <td className={v2Bad.has(i) ? 'py-1 font-semibold text-destructive' : 'py-1 text-foreground'}>
                {v2Values[i]}px
              </td>
              <td className="py-1">
                <div className="h-2.5 rounded-xs bg-primary" style={{ width: v2Values[i] }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="max-w-[70ch] text-caption text-muted-foreground">
        Shipped regressions: <strong className="text-destructive">{shippedBad.size}</strong> · v2 regressions:{' '}
        <strong className={v2Bad.size === 0 ? 'text-mf-success' : 'text-destructive'}>{v2Bad.size}</strong>
      </p>
    </section>
  );
}
