import { useTheme, type ThemeMode, type ColorScheme, type WindowStyle } from '../../../../store/theme';
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

function PickerRow<T extends string>({
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
      <span className="text-body text-mf-text-secondary">{label}</span>
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
                ? 'bg-mf-surface-overlay text-mf-text-primary'
                : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-surface-overlay/50',
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
  const setMode = useTheme((s) => s.setMode);
  const setScheme = useTheme((s) => s.setScheme);
  const setWindowStyle = useTheme((s) => s.setWindowStyle);

  return (
    <div className="flex flex-col gap-3">
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
