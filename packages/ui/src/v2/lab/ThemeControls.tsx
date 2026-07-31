export const SCHEMES = ['classic', 'ocean', 'velvet'] as const;
export type Scheme = (typeof SCHEMES)[number];

export const WINDOW_STYLES = ['glass', 'unified', 'split'] as const;

interface ThemeControlsProps {
  dark: boolean;
  onDarkChange: (dark: boolean) => void;
  scheme: Scheme;
  onSchemeChange: (scheme: Scheme) => void;
  children?: React.ReactNode;
}

function chip(active: boolean): string {
  return [
    'rounded-sm px-2.5 py-1 text-caption capitalize transition-colors',
    active ? 'bg-primary text-primary-foreground' : 'bg-mf-chip text-muted-foreground hover:text-foreground',
  ].join(' ');
}

export function ThemeControls({ dark, onDarkChange, scheme, onSchemeChange, children }: ThemeControlsProps) {
  return (
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-1.5 text-body">
        <input
          type="checkbox"
          data-testid="v2-lab-dark"
          checked={dark}
          onChange={(e) => onDarkChange(e.target.checked)}
        />
        Dark
      </label>

      <div className="flex items-center gap-1.5">
        {SCHEMES.map((s) => (
          <button
            key={s}
            type="button"
            data-testid={`v2-lab-scheme-${s}`}
            onClick={() => onSchemeChange(s)}
            className={chip(scheme === s)}
          >
            {s}
          </button>
        ))}
      </div>

      {children}
    </div>
  );
}

export { chip as labChipClass };
