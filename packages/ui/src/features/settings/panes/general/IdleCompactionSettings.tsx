import { useRef, useState } from 'react';
import { useSettingsStore } from '@/store/settings';
import { updateGeneralSettings } from '@/lib/api/settings';
import { ToggleRow } from '../shared/ToggleRow';

export function IdleCompactionSettings({ port }: { port: number }) {
  const enabled = useSettingsStore((s) => s.general.idleCompaction.enabled);
  const [pending, setPending] = useState<boolean | null>(null);
  const saving = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save(enabled: boolean) {
    if (saving.current) return;
    saving.current = true;
    setPending(enabled);
    setSaveError(null);
    try {
      await updateGeneralSettings(port, { idleCompaction: { enabled } });
      useSettingsStore.getState().patchGeneral({ idleCompaction: { enabled } });
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      saving.current = false;
      setPending(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t border-border py-5">
      <h3 className="text-sm font-semibold text-foreground">Chats</h3>
      <ToggleRow
        label="Compact idle chats"
        description="Summarize long idle chats before the provider's prompt cache expires, so returning is cheaper."
        checked={pending ?? enabled}
        disabled={pending !== null}
        onChange={(value) => void save(value)}
        testId="idle-compaction-enabled"
      />
      {saveError !== null && (
        <p role="alert" className="text-xs text-destructive">
          {saveError}
        </p>
      )}
    </section>
  );
}
