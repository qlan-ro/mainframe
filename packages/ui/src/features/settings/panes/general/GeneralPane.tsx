import { useState } from 'react';
import { useSettingsStore } from '../../../../store/settings';
import { updateGeneralSettings } from '../../../../lib/api/settings';
import { AppearanceControls } from './AppearanceControls';

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

  return (
    <div data-testid="settings-pane-general" className="flex flex-col gap-6 p-4">
      <h2 className="text-title font-bold text-foreground">General</h2>

      <section className="flex flex-col gap-3">
        <h3 className="text-label font-semibold text-mf-text-3">Appearance</h3>
        <AppearanceControls />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-label font-semibold text-mf-text-3">Worktree directory</h3>
        <p className="text-label text-muted-foreground">
          Relative path where worktrees are created inside project roots.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            data-testid="settings-worktree-dir-input"
            value={displayDir}
            onChange={handleDirChange}
            className="h-[30px] flex-1 rounded border border-input bg-card px-[11px] text-body text-foreground outline-none focus:border-primary"
          />
          {isDirty && (
            <button
              type="button"
              data-testid="settings-worktree-dir-save"
              onClick={handleSave}
              className="inline-flex h-[30px] items-center justify-center rounded bg-primary px-[11px] text-body text-primary-foreground hover:opacity-90"
            >
              Save
            </button>
          )}
        </div>
        {saveError !== null && <p className="text-label text-destructive">{saveError}</p>}
      </section>
    </div>
  );
}
