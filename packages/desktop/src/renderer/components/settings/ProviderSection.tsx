import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useSettingsStore } from '../../store/settings';
import { useAdaptersStore } from '../../store/adapters';
import { getConfigConflicts, updateProviderSettings } from '../../lib/api';
import { getModelOptions } from '../../lib/adapters';
import type { ProviderConfig } from '@mainframe/types';
import { ModelDropdown } from './ModelDropdown';
import { MODE_OPTIONS, EXECUTION_MODE_OPTIONS } from './constants';

const EMPTY_CONFIG: ProviderConfig = {};

export function ProviderSection({ adapterId, label }: { adapterId: string; label: string }) {
  const config = useSettingsStore((s) => s.providers[adapterId] ?? EMPTY_CONFIG);
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig);
  const adapters = useAdaptersStore((s) => s.adapters);
  const models = getModelOptions(adapterId, adapters);
  const [conflicts, setConflicts] = useState<string[]>([]);

  useEffect(() => {
    getConfigConflicts(adapterId)
      .then(setConflicts)
      .catch((err) => console.warn('[settings] fetch config conflicts failed:', err));
  }, [adapterId]);

  const update = useCallback(
    (partial: Partial<ProviderConfig>) => {
      const next = { ...config, ...partial };
      setProviderConfig(adapterId, next);
      updateProviderSettings(adapterId, partial).catch((err) =>
        console.warn('[settings] update provider settings failed:', err),
      );
    },
    [adapterId, config, setProviderConfig],
  );

  return (
    <div className="space-y-4">
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

      {/* Default Model */}
      <ModelDropdown
        value={config.defaultModel ?? ''}
        options={[{ id: '', label: 'None (use provider default)' }, ...models]}
        onChange={(v) => update({ defaultModel: v || undefined })}
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
                type="radio"
                name={`${adapterId}-mode`}
                checked={(config.defaultMode ?? 'default') === mode.id}
                onChange={() => update({ defaultMode: mode.id })}
                className={`mt-0.5 ${mode.danger ? 'accent-mf-destructive' : 'accent-mf-accent'}`}
              />
              <div>
                <span className={`text-mf-small ${mode.danger ? 'text-mf-destructive' : 'text-mf-text-primary'}`}>
                  {mode.label}
                </span>
                <p className="text-mf-status text-mf-text-secondary">{mode.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Plan execution mode (shown when Plan Mode is active) */}
      {(config.defaultMode ?? 'default') === 'plan' && (
        <div className="space-y-1.5">
          <label className="text-mf-small text-mf-text-secondary">After Plan Approval</label>
          <div className="space-y-1">
            {EXECUTION_MODE_OPTIONS.map((mode) => (
              <label
                key={mode.id}
                className="flex items-start gap-2.5 px-3 py-2 rounded-mf-input cursor-pointer hover:bg-mf-hover transition-colors"
              >
                <input
                  type="radio"
                  name={`${adapterId}-exec-mode`}
                  checked={(config.planExecutionMode ?? 'default') === mode.id}
                  onChange={() => update({ planExecutionMode: mode.id })}
                  className={`mt-0.5 ${mode.id === 'yolo' ? 'accent-mf-destructive' : 'accent-mf-accent'}`}
                />
                <div>
                  <span
                    className={`text-mf-small ${mode.id === 'yolo' ? 'text-mf-destructive' : 'text-mf-text-primary'}`}
                  >
                    {mode.label}
                  </span>
                  <p className="text-mf-status text-mf-text-secondary">{mode.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
