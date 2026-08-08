import { useState } from 'react';
import type { UpdateChannel } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '../../../../store/settings';
import { updateGeneralSettings } from '../../../../lib/api/settings';
import { AppearanceControls, PickerRow } from './AppearanceControls';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const UPDATE_CHANNEL_OPTIONS: { id: UpdateChannel; label: string }[] = [
  { id: 'stable', label: 'Stable' },
  { id: 'prerelease', label: 'Pre-release (RC)' },
];

export function GeneralPane({ port }: { port: number }) {
  const general = useSettingsStore((s) => s.general);
  const loadGeneral = useSettingsStore((s) => s.loadGeneral);
  const [localDir, setLocalDir] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const displayDir = localDir ?? general.worktreeDir;
  const isDirty = localDir !== null && localDir !== general.worktreeDir;

  function handleDirChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalDir(e.target.value);
    setSaveError(null);
  }

  function handleSave() {
    if (!isDirty || localDir === null) return;
    const dir = localDir;
    updateGeneralSettings(port, { worktreeDir: dir })
      .then(() => {
        loadGeneral({ ...general, worktreeDir: dir });
        setLocalDir(null);
      })
      .catch((err: unknown) => {
        console.warn('[settings/GeneralPane]', err);
        setSaveError(err instanceof Error ? err.message : 'Save failed');
      });
  }

  function handleUpdateChannelSelect(updateChannel: UpdateChannel) {
    updateGeneralSettings(port, { updateChannel })
      .then(() => loadGeneral({ ...general, updateChannel }))
      .catch((err: unknown) => console.warn('[settings/GeneralPane]', err));
  }

  return (
    <div data-testid="settings-pane-general" className="flex flex-col gap-6 p-4">
      <h2 className="text-lg font-semibold text-foreground">General</h2>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">Appearance</h3>
        <AppearanceControls />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">Worktree directory</h3>
        <p className="text-xs text-muted-foreground">Relative path where worktrees are created inside project roots.</p>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            data-testid="settings-worktree-dir-input"
            value={displayDir}
            onChange={handleDirChange}
            className="h-8 flex-1"
          />
          {isDirty && (
            <Button size="sm" data-testid="settings-worktree-dir-save" onClick={handleSave}>
              Save
            </Button>
          )}
        </div>
        {saveError !== null && <p className="text-xs text-destructive">{saveError}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">Updates</h3>
        <PickerRow
          label="Channel"
          options={UPDATE_CHANNEL_OPTIONS}
          current={general.updateChannel}
          prefix="settings-updates-channel"
          onSelect={handleUpdateChannelSelect}
        />
      </section>
    </div>
  );
}
