import { useId, useRef, useState } from 'react';
import { HISTORY_RELEASE_MINUTE_OPTIONS } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '@/store/settings';
import { updateGeneralSettings } from '@/lib/api/settings';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const NEVER = 'never';

function minutesLabel(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} min`;
}

function optionId(idleMinutes: number | null): string {
  return idleMinutes === null ? NEVER : String(idleMinutes);
}

/** The offered idle times, plus a stored value the daemon accepts but the UI does not offer. */
function options(current: number | null): { id: string; label: string }[] {
  const minutes: number[] = [...HISTORY_RELEASE_MINUTE_OPTIONS];
  if (current !== null && !minutes.includes(current)) {
    minutes.push(current);
    minutes.sort((a, b) => a - b);
  }
  return [...minutes.map((m) => ({ id: String(m), label: minutesLabel(m) })), { id: NEVER, label: 'Never' }];
}

/** How long a chat nobody has open or uses keeps its history in the daemon's memory. */
export function HistoryReleaseSettings({ port }: { port: number }) {
  const idleMinutes = useSettingsStore((s) => s.general.historyRelease.idleMinutes);
  const [pending, setPending] = useState<number | null | undefined>(undefined);
  const saving = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const labelId = useId();
  const descriptionId = useId();
  const shown = pending === undefined ? idleMinutes : pending;

  async function save(next: number | null) {
    if (saving.current) return;
    saving.current = true;
    setPending(next);
    setSaveError(null);
    try {
      await updateGeneralSettings(port, { historyRelease: { idleMinutes: next } });
      useSettingsStore.getState().patchGeneral({ historyRelease: { idleMinutes: next } });
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      saving.current = false;
      setPending(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-1 px-0.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <span id={labelId} className="text-sm text-foreground">
            Free memory of idle chats
          </span>
          <p id={descriptionId} className="mt-0.5 text-xs text-muted-foreground">
            After this long unopened and unused, a chat&apos;s history leaves memory. It reloads when you return.
          </p>
        </div>
        <ToggleGroup
          type="single"
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          data-testid="history-release-group"
          variant="outline"
          size="sm"
          value={optionId(shown)}
          disabled={pending !== undefined}
          onValueChange={(value) => {
            if (!value || value === optionId(shown)) return;
            void save(value === NEVER ? null : Number(value));
          }}
        >
          {options(idleMinutes).map((option) => (
            <ToggleGroupItem
              key={option.id}
              value={option.id}
              data-testid={`history-release-${option.id}`}
              className="flex-none px-3"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {saveError !== null && (
        <p role="alert" className="text-xs text-fail">
          {saveError}
        </p>
      )}
    </div>
  );
}
