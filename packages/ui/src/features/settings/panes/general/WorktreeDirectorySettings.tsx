import { useState } from 'react';
import { useSettingsStore } from '@/store/settings';
import { updateGeneralSettings } from '@/lib/api/settings';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

function useWorktreeDirectory(port: number) {
  const general = useSettingsStore((s) => s.general);
  const patchGeneral = useSettingsStore((s) => s.patchGeneral);
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
        patchGeneral({ worktreeDir: dir });
        setLocalDir(null);
      })
      .catch((err: unknown) => {
        console.warn('[settings/GeneralPane]', err);
        setSaveError(err instanceof Error ? err.message : 'Save failed');
      });
  }

  return { displayDir, isDirty, saveError, handleDirChange, handleSave };
}

export function WorktreeDirectorySettings({ port }: { port: number }) {
  const { displayDir, isDirty, saveError, handleDirChange, handleSave } = useWorktreeDirectory(port);
  return (
    <section className="flex flex-col gap-3 border-t border-border py-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-foreground">Worktree directory</h3>
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
  );
}
