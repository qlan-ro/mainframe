import { useTheme, type ThemeMode, type UiScale } from '../../../../store/theme';
import { useUiPrefs, type TranscriptMode } from '@/store/ui-prefs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const UI_SIZES: { id: UiScale; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'normal', label: 'Normal' },
  { id: 'large', label: 'Large' },
];

const TRANSCRIPT_MODES: { id: TranscriptMode; label: string }[] = [
  { id: 'verbose', label: 'Verbose' },
  { id: 'compact', label: 'Compact' },
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
      <span className="text-sm text-muted-foreground">{label}</span>
      <ToggleGroup
        type="single"
        aria-label={label}
        data-testid={`${prefix}-group`}
        variant="outline"
        size="sm"
        value={current}
        onValueChange={(v) => {
          if (v) onSelect(v as T);
        }}
      >
        {options.map((opt) => (
          <ToggleGroupItem key={opt.id} value={opt.id} data-testid={`${prefix}-${opt.id}`} className="px-3">
            {opt.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function AppearanceControls() {
  const mode = useTheme((s) => s.mode);
  const uiScale = useTheme((s) => s.uiScale);
  const setMode = useTheme((s) => s.setMode);
  const setUiScale = useTheme((s) => s.setUiScale);
  const transcriptMode = useUiPrefs((s) => s.transcriptMode);
  const setTranscriptMode = useUiPrefs((s) => s.setTranscriptMode);

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
        label="Transcript"
        options={TRANSCRIPT_MODES}
        current={transcriptMode}
        prefix="settings-appearance-transcript"
        onSelect={setTranscriptMode}
      />
    </div>
  );
}
