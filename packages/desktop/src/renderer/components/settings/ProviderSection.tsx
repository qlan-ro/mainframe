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

const EMPTY_CONFIG: ProviderConfig = {};

export function ProviderSection({ adapterId, label }: { adapterId: string; label: string }) {
  const config = useSettingsStore((s) => s.providers[adapterId] ?? EMPTY_CONFIG);
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig);
  const adapters = useAdaptersStore((s) => s.adapters);
  const adapter = adapters.find((entry) => entry.id === adapterId);
  const models = getModelOptions(adapterId, adapters);
  const [conflicts, setConflicts] = useState<string[]>([]);

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

  return (
    <div className="space-y-4">
      {/* Executable Path */}
      <div className="space-y-1.5">
        <label className="text-mf-small text-mf-text-secondary">Executable Path</label>
        <input
          type="text"
          value={config.executablePath ?? ''}
          onChange={(e) => update({ executablePath: e.target.value || undefined })}
          placeholder={adapterId}
          className="w-full px-3 py-1.5 text-mf-small bg-mf-input-bg text-mf-text-primary border border-mf-border rounded-mf-input focus:outline-none focus:border-mf-accent"
        />
        <p className="text-mf-status text-mf-text-secondary">
          Full path to the CLI binary. Leave empty to use system PATH.
        </p>
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
          <span className="flex items-center h-[18px] shrink-0">
            <input
              type="checkbox"
              checked={config.systemPrompt === 'enabled'}
              onChange={(e) => update({ systemPrompt: e.target.checked ? 'enabled' : '' })}
              className="h-4 w-4 accent-mf-accent m-0"
            />
          </span>
          <div className="flex-1">
            <span className="text-mf-small text-mf-text-primary">Enforce AskUserQuestion for agent questions</span>
            <p className="text-mf-status text-mf-text-secondary">
              Instructs the agent to use the interactive AskUserQuestion tool instead of asking in plain text.
            </p>
          </div>
        </label>

        {adapter?.capabilities.planMode && (
          <label className="flex items-start gap-2.5 px-3 py-2 rounded-mf-input cursor-pointer hover:bg-mf-hover transition-colors">
            <span className="flex items-center h-[18px] shrink-0">
              <input
                type="checkbox"
                checked={config.defaultPlanMode === 'true'}
                onChange={(e) => update({ defaultPlanMode: e.target.checked ? 'true' : 'false' })}
                className="h-4 w-4 accent-mf-accent m-0"
              />
            </span>
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
              <span className="flex items-center h-[18px] shrink-0">
                <input
                  type="radio"
                  name={`${adapterId}-mode`}
                  checked={(config.defaultMode ?? 'default') === mode.id}
                  onChange={() => update({ defaultMode: mode.id })}
                  className={`h-4 w-4 m-0 ${mode.danger ? 'accent-mf-destructive' : 'accent-mf-accent'}`}
                />
              </span>
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
    </div>
  );
}
