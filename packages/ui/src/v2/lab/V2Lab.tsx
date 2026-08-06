/**
 * Dev harness for the clone: the ported shell, or a specimen sheet of the
 * primitives, under either mode.
 *
 * Light/dark is the only theme axis left — the shipped app's three colour
 * schemes and three window styles came off with the custom token layer.
 */
import { useEffect, useState } from 'react';
import { V2Shell } from '@v2/app/V2Shell';
import { FormSpecimen } from './FormSpecimen';

const VIEWS = ['shell', 'specimen'] as const;
type View = (typeof VIEWS)[number];

function chip(active: boolean): string {
  return [
    'rounded-md px-2.5 py-1 text-xs capitalize transition-colors',
    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
  ].join(' ');
}

export function V2Lab() {
  const [dark, setDark] = useState(false);
  const [view, setView] = useState<View>('shell');

  // The tokens key off <html>, not a wrapper, so the lab drives the real class
  // rather than a local copy that could drift from the app's.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return (
    <div className="flex h-screen flex-col bg-background font-sans text-foreground">
      <div className="flex shrink-0 items-center gap-4 border-b px-4 py-2">
        <div className="flex items-center gap-1.5">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              data-testid={`v2-lab-view-${v}`}
              onClick={() => setView(v)}
              className={chip(view === v)}
            >
              {v}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" data-testid="v2-lab-dark" checked={dark} onChange={(e) => setDark(e.target.checked)} />
          Dark
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {view === 'shell' ? (
          <V2Shell />
        ) : (
          <div className="px-8 py-6">
            <FormSpecimen />
          </div>
        )}
      </div>
    </div>
  );
}
