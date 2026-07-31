/**
 * The v2 scale lab — what verifies the token layer landed, until the app shell
 * is ported and there's a real surface to look at.
 */
import { useEffect, useState } from 'react';
import { FormSpecimen } from './FormSpecimen';
import { SpacingScale } from './SpacingScale';
import { TypeScale } from './TypeScale';

const SCHEMES = ['classic', 'ocean', 'velvet'] as const;
type Scheme = (typeof SCHEMES)[number];

export function ScaleLab() {
  const [dark, setDark] = useState(false);
  const [scheme, setScheme] = useState<Scheme>('classic');

  // The scheme tokens key off <html>, not a wrapper, so the lab drives the real
  // attributes rather than a local copy that could drift from the app's.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    if (scheme === 'classic') root.removeAttribute('data-scheme');
    else root.setAttribute('data-scheme', scheme);
  }, [dark, scheme]);

  return (
    <div className="min-h-screen bg-mf-window px-8 py-6 font-sans text-foreground">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-title font-bold">Mainframe v2 — scale</h1>
          <p className="max-w-[70ch] text-body text-muted-foreground">
            Colours, radii, shadows and the three schemes are imported from the shipped stylesheet and unchanged. Only
            spacing and type differ, and both are measured below rather than asserted.
          </p>

          <div className="mt-1 flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-body">
              <input
                type="checkbox"
                data-testid="v2-lab-dark"
                checked={dark}
                onChange={(e) => setDark(e.target.checked)}
              />
              Dark
            </label>
            <div className="flex items-center gap-1.5">
              {SCHEMES.map((s) => (
                <button
                  key={s}
                  type="button"
                  data-testid={`v2-lab-scheme-${s}`}
                  onClick={() => setScheme(s)}
                  className={[
                    'rounded-sm px-2.5 py-1 text-caption capitalize transition-colors',
                    scheme === s
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-mf-chip text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </header>

        <SpacingScale />
        <TypeScale />
        <FormSpecimen />
      </div>
    </div>
  );
}
