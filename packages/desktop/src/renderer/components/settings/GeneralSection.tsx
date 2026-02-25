import React, { useState, useCallback } from 'react';
import { GENERAL_DEFAULTS } from '@mainframe/types';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:settings');
import { useThemeStore, THEMES } from '../../store/theme';
import { useSettingsStore } from '../../store/settings';
import { updateGeneralSettings } from '../../lib/api';

export function GeneralSection(): React.ReactElement {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const general = useSettingsStore((s) => s.general);
  const loadGeneral = useSettingsStore((s) => s.loadGeneral);

  const [worktreeDir, setWorktreeDir] = useState(general.worktreeDir);
  const [saving, setSaving] = useState(false);

  // Sync local state when store changes (e.g. on modal reopen)
  React.useEffect(() => {
    setWorktreeDir(general.worktreeDir);
  }, [general.worktreeDir]);

  const dirty = worktreeDir !== general.worktreeDir;

  const handleSave = useCallback(async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await updateGeneralSettings({ worktreeDir });
      loadGeneral({ ...general, worktreeDir });
    } catch (err) {
      log.warn('save failed', { err: String(err) });
    } finally {
      setSaving(false);
    }
  }, [dirty, worktreeDir, general, loadGeneral]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-mf-heading font-semibold text-mf-text-primary mb-4">General</h3>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-mf-small text-mf-text-secondary">Theme</label>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => setTheme(theme.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-mf-input border transition-colors text-left ${
                    themeId === theme.id
                      ? 'border-mf-accent bg-mf-hover'
                      : 'border-mf-divider hover:border-mf-border hover:bg-mf-hover/50'
                  }`}
                >
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: theme.accent }} />
                  <span className="text-mf-small text-mf-text-primary">{theme.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-mf-small text-mf-text-secondary">Worktree directory</label>
            <p className="text-mf-status text-mf-text-tertiary">
              Relative directory name within each project for git worktrees.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={worktreeDir}
                onChange={(e) => setWorktreeDir(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                }}
                placeholder={GENERAL_DEFAULTS.worktreeDir}
                className="flex-1 px-3 py-1.5 text-mf-small bg-mf-input-bg border border-mf-divider rounded-mf-input text-mf-text-primary placeholder:text-mf-text-tertiary focus:outline-none focus:border-mf-accent"
              />
              {dirty && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1.5 text-mf-small bg-mf-accent text-white rounded-mf-input hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
