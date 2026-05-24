import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:settings');
import { useSettingsStore } from '../../store/settings';
import { useAdaptersStore } from '../../store/adapters';
import { getConfigConflicts, updateProviderSettings } from '../../lib/api';
import { getModelOptions } from '../../lib/adapters';
import type { ProviderConfig } from '@qlan-ro/mainframe-types';
import { ModelDropdown } from './ModelDropdown';
import { MODE_OPTIONS } from './constants';
import { DirectoryPickerModal } from '../DirectoryPickerModal';

const EMPTY_CONFIG: ProviderConfig = {};

export function ProviderSection({ adapterId, label }: { adapterId: string; label: string }) {
  const config = useSettingsStore((s) => s.providers[adapterId] ?? EMPTY_CONFIG);
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig);
  const adapters = useAdaptersStore((s) => s.adapters);
  const adapter = adapters.find((entry) => entry.id === adapterId);
  const models = getModelOptions(adapterId, adapters);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [showBinaryPicker, setShowBinaryPicker] = useState(false);

  useEffect(() => {
    getConfigConflicts(adapterId)
      .then(setConflicts)
      .catch((err) => log.warn('fetch config conflicts failed', { err: String(err) }));
  }, [adapterId]);

  const update = useCallback(
    (partial: Partial<ProviderConfig>) => {
      const next = { ...config, ...partial };
      setProviderConfig(adapterId, next);
      updateProviderSettings(adapterId, partial).catch((err) =>
        log.warn('update provider settings failed', { err: String(err) }),
      );
    },
    [adapterId, config, setProviderConfig],
  );

  const handlePickBinary = useCallback(
    (p: string) => {
      setShowBinaryPicker(false);
      update({ executablePath: p });
    },
    [update],
  );

  return (
    <div className="space-y-4">
      {/* Executable Path */}
      <div className="space-y-1.5">
        <label className="text-mf-small text-mf-text-secondary">Executable Path</label>
        <div className="flex gap-2">
          <input
            data-testid={`providers-${adapterId}-executable-path-input`}
            type="text"
            value={config.executablePath ?? ''}
            onChange={(e) => update({ executablePath: e.target.value || undefined })}
            placeholder={adapterId}
            className="flex-1 px-3 py-1.5 text-mf-small bg-mf-input-bg text-mf-text-primary border border-mf-border rounded-mf-input focus:outline-none focus:border-mf-accent"
          />
          <button
            type="button"
            data-testid={`providers-${adapterId}-executable-path-browse`}
            onClick={() => setShowBinaryPicker(true)}
            className="px-3 py-1.5 text-mf-small bg-mf-input-bg text-mf-text-secondary border border-mf-border rounded-mf-input hover:text-mf-text-primary hover:border-mf-accent transition-colors"
          >
            Browse…
          </button>
        </div>
        {config.resolvedExecutable?.source === 'fallback' && (
          <p className="text-mf-status text-mf-text-secondary">Not found on PATH — Browse to select the binary</p>
        )}
      </div>

      {/* Config conflict warning */}
      {conflicts.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-mf-input bg-mf-warning/10 border border-mf-warning/30">
          <AlertTriangle size={14} className="text-mf-warning shrink-0 mt-0.5" />
          <p className="text-mf-small text-mf-warning">
            Claude Code settings.json defines {conflicts.join(', ')}. Mainframe flags will take precedence when
            launching sessions.
          </p>
        </div>
      )}

      {/* Toggles */}
      <div className="space-y-1">
        <label className="flex items-start gap-2.5 px-3 py-2 rounded-mf-input cursor-pointer hover:bg-mf-hover transition-colors">
          <input
            data-testid={`providers-${adapterId}-system-prompt-toggle`}
            type="checkbox"
            checked={config.systemPrompt === 'enabled'}
            onChange={(e) => update({ systemPrompt: e.target.checked ? 'enabled' : '' })}
            className="h-4 w-4 accent-mf-accent shrink-0 m-0"
            style={{ marginTop: 'calc((1.125rem - 1rem) / 2)' }}
          />
          <div className="flex-1">
            <span className="text-mf-small text-mf-text-primary">Enforce AskUserQuestion for agent questions</span>
            <p className="text-mf-status text-mf-text-secondary">
              Instructs the agent to use the interactive AskUserQuestion tool instead of asking in plain text.
            </p>
          </div>
        </label>

        {adapter?.capabilities.planMode && (
          <label className="flex items-start gap-2.5 px-3 py-2 rounded-mf-input cursor-pointer hover:bg-mf-hover transition-colors">
            <input
              data-testid={`providers-${adapterId}-plan-mode-toggle`}
              type="checkbox"
              checked={config.defaultPlanMode === 'true'}
              onChange={(e) => update({ defaultPlanMode: e.target.checked ? 'true' : 'false' })}
              className="h-4 w-4 accent-mf-accent shrink-0 m-0"
              style={{ marginTop: 'calc((1.125rem - 1rem) / 2)' }}
            />
            <div className="flex-1">
              <span className="text-mf-small text-mf-text-primary">Start in Plan Mode</span>
              <p className="text-mf-status text-mf-text-secondary">
                New chats begin with plan mode enabled. You can toggle it off mid-session.
              </p>
            </div>
          </label>
        )}
      </div>

      {/* Default Model — picking "Default" delegates to the CLI's own default (e.g. Opus 4.7 on Max). */}
      <ModelDropdown
        value={config.defaultModel ?? 'default'}
        options={models}
        onChange={(v) => update({ defaultModel: v })}
      />

      {/* Default Mode */}
      <div className="space-y-1.5">
        <label className="text-mf-small text-mf-text-secondary">Default Session Mode</label>
        <div className="space-y-1">
          {MODE_OPTIONS.map((mode) => (
            <label
              key={mode.id}
              className="flex items-start gap-2.5 px-3 py-2 rounded-mf-input cursor-pointer hover:bg-mf-hover transition-colors"
            >
              <input
                data-testid={`providers-${adapterId}-mode-option-${mode.id}`}
                type="radio"
                name={`${adapterId}-mode`}
                checked={(config.defaultMode ?? 'default') === mode.id}
                onChange={() => update({ defaultMode: mode.id })}
                className={`h-4 w-4 shrink-0 m-0 ${mode.danger ? 'accent-mf-destructive' : 'accent-mf-accent'}`}
                style={{ marginTop: 'calc((1.125rem - 1rem) / 2)' }}
              />
              <div className="flex-1">
                <span className={`text-mf-small ${mode.danger ? 'text-mf-destructive' : 'text-mf-text-primary'}`}>
                  {mode.label}
                </span>
                <p className="text-mf-status text-mf-text-secondary">{mode.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <DirectoryPickerModal
        open={showBinaryPicker}
        mode="file"
        title={`Select ${label} Executable`}
        onSelect={handlePickBinary}
        onCancel={() => setShowBinaryPicker(false)}
      />
    </div>
  );
}
