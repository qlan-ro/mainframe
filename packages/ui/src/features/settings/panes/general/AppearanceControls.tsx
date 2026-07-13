import { useTheme, type ThemeMode, type ColorScheme, type WindowStyle, type UiScale } from '../../../../store/theme';
import { cn } from '@/lib/utils';

const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const SCHEMES: { id: ColorScheme; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'velvet', label: 'Velvet' },
];

const WINDOW_STYLES: { id: WindowStyle; label: string }[] = [
  { id: 'unified', label: 'Unified' },
  { id: 'split', label: 'Split' },
  { id: 'glass', label: 'Glass' },
];

const UI_SIZES: { id: UiScale; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'normal', label: 'Normal' },
  { id: 'large', label: 'Large' },
];

export function PickerRow<T extends string>({
  label,
  options,
  current,
  prefix,
  onSelect,
}: {
  label: string;
  options: { id: T; label: string }[];
  current: T;
  prefix: string;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-body text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            data-testid={`${prefix}-${opt.id}`}
            onClick={() => onSelect(opt.id)}
            className={cn(
              'px-3 py-1 rounded text-body transition-colors',
              current === opt.id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppearanceControls() {
  const mode = useTheme((s) => s.mode);
  const scheme = useTheme((s) => s.scheme);
  const windowStyle = useTheme((s) => s.windowStyle);
  const uiScale = useTheme((s) => s.uiScale);
  const setMode = useTheme((s) => s.setMode);
  const setScheme = useTheme((s) => s.setScheme);
  const setWindowStyle = useTheme((s) => s.setWindowStyle);
  const setUiScale = useTheme((s) => s.setUiScale);

  return (
    <div className="flex flex-col gap-3">
      <PickerRow
        label="UI Size"
        options={UI_SIZES}
        current={uiScale}
        prefix="settings-appearance-ui-scale"
        onSelect={setUiScale}
      />
      <PickerRow label="Mode" options={MODES} current={mode} prefix="settings-appearance-mode" onSelect={setMode} />
      <PickerRow
        label="Color Scheme"
        options={SCHEMES}
        current={scheme}
        prefix="settings-appearance-scheme"
        onSelect={setScheme}
      />
      <PickerRow
        label="Window Style"
        options={WINDOW_STYLES}
        current={windowStyle}
        prefix="settings-appearance-window-style"
        onSelect={setWindowStyle}
      />
    </div>
  );
}
