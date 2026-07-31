/**
 * Dev harness for the clone. Owns the theme attributes for both views so there
 * is one place that writes them — the scale view and the shell view have to be
 * looked at under the same six scheme × mode combinations.
 */
import { useEffect, useState } from 'react';
import type { WindowStyle } from '@/store/theme';
import { V2Shell } from '@v2/app/V2Shell';
import { ScaleLab } from './ScaleLab';
import { labChipClass, ThemeControls, WINDOW_STYLES, type Scheme } from './ThemeControls';

type View = 'shell' | 'scale';

export function V2Lab() {
  const [dark, setDark] = useState(false);
  const [scheme, setScheme] = useState<Scheme>('classic');
  const [windowStyle, setWindowStyle] = useState<WindowStyle>('glass');
  const [view, setView] = useState<View>('shell');

  // The scheme tokens key off <html>, not a wrapper, so the lab drives the real
  // attributes rather than a local copy that could drift from the app's.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    if (scheme === 'classic') root.removeAttribute('data-scheme');
    else root.setAttribute('data-scheme', scheme);
  }, [dark, scheme]);

  return (
    <div className="flex h-screen flex-col bg-mf-window font-sans text-foreground">
      <div className="flex shrink-0 items-center gap-4 border-b border-border px-4 py-2">
        <div className="flex items-center gap-1.5">
          {(['shell', 'scale'] as const).map((v) => (
            <button
              key={v}
              type="button"
              data-testid={`v2-lab-view-${v}`}
              onClick={() => setView(v)}
              className={labChipClass(view === v)}
            >
              {v}
            </button>
          ))}
        </div>

        <ThemeControls dark={dark} onDarkChange={setDark} scheme={scheme} onSchemeChange={setScheme}>
          {view === 'shell' && (
            <div className="flex items-center gap-1.5">
              {WINDOW_STYLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  data-testid={`v2-lab-window-${s}`}
                  onClick={() => setWindowStyle(s)}
                  className={labChipClass(windowStyle === s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </ThemeControls>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {view === 'shell' ? <V2Shell windowStyle={windowStyle} /> : <ScaleLab />}
      </div>
    </div>
  );
}
