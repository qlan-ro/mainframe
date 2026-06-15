import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdapterInfo, ProviderConfig, ProviderConfigUpdate } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '../../../../store/settings';
import { updateProviderSettings, getConfigConflicts } from '../../../../lib/api/settings';
import { SessionModeRadio } from './SessionModeRadio';
import { ConfigConflictsWarning } from './ConfigConflictsWarning';
import { ModelDropdown } from './ModelDropdown';
import { ProviderTuningDefaults } from './ProviderTuningDefaults';
import { CodexTuningDefaults } from './CodexTuningDefaults';

const EMPTY_CONFIG: ProviderConfig = {};

interface ProviderConfigFormProps {
  port: number;
  adapterId: string;
  label: string;
  adapter: AdapterInfo;
}

/** Optimistic update: applies the patch locally then PUTs to daemon.
 *  The '' sentinel clears the key so the control falls back to the inherited default. */
function applyUpdate(
  port: number,
  adapterId: string,
  config: ProviderConfig,
  setProviderConfig: (id: string, c: ProviderConfig) => void,
  partial: ProviderConfigUpdate,
): void {
  const next: Record<string, unknown> = { ...config };
  for (const [k, v] of Object.entries(partial)) {
    if (v === '') delete next[k];
    else next[k] = v;
  }
  setProviderConfig(adapterId, next as ProviderConfig);
  updateProviderSettings(port, adapterId, partial).catch((err: unknown) =>
    console.warn('[settings/ProviderConfigForm]', err),
  );
}

function buildModelOptions(adapter: AdapterInfo) {
  return [
    { id: 'default', label: 'Default (CLI picks)' },
    ...adapter.models.map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
    })),
  ];
}

export function ProviderConfigForm({ port, adapterId, label, adapter }: ProviderConfigFormProps) {
  const config = useSettingsStore((s) => s.providers[adapterId] ?? EMPTY_CONFIG);
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig);
  const [conflicts, setConflicts] = useState<string[]>([]);
  // Local state for the exec path input — commits on blur only (not per-keystroke).
  const [execPath, setExecPath] = useState(config.executablePath ?? '');
  // Ref to track whether execPath was changed from external store reset (adapter switch).
  const externalPathRef = useRef(config.executablePath ?? '');

  useEffect(() => {
    getConfigConflicts(port, adapterId)
      .then(setConflicts)
      .catch((err: unknown) => console.warn('[settings/ProviderConfigForm] conflicts fetch failed', err));
  }, [port, adapterId]);

  // Sync local input when the stored executablePath changes externally.
  useEffect(() => {
    const stored = config.executablePath ?? '';
    if (stored !== externalPathRef.current) {
      externalPathRef.current = stored;
      setExecPath(stored);
    }
  }, [config.executablePath]);

  const update = useCallback(
    (partial: ProviderConfigUpdate) => {
      applyUpdate(port, adapterId, config, setProviderConfig, partial);
    },
    [port, adapterId, config, setProviderConfig],
  );

  function handleExecPathBlur() {
    const trimmed = execPath.trim();
    if (trimmed !== (config.executablePath ?? '')) {
      update({ executablePath: trimmed || undefined });
    }
  }

  const defaultModel =
    adapter.models.find((m) => m.id === (config.defaultModel ?? '')) ??
    adapter.models.find((m) => m.isDefault) ??
    adapter.models[0];

  const modelOptions = buildModelOptions(adapter);

  return (
    <div data-testid={`settings-pane-provider-${adapterId}`} className="space-y-4">
      {/* Executable path — commits on blur to avoid one PUT per keystroke */}
      <div className="space-y-1.5">
        <label className="text-xs text-mf-text-secondary">Executable Path</label>
        <input
          data-testid={`settings-${adapterId}-executable-path-input`}
          type="text"
          value={execPath}
          onChange={(e) => setExecPath(e.target.value)}
          onBlur={handleExecPathBlur}
          placeholder={label.toLowerCase()}
          className="w-full px-3 py-1.5 text-sm bg-mf-input-bg text-mf-text-primary border border-mf-border rounded-md focus:outline-none focus:border-mf-accent"
        />
        {config.resolvedExecutable?.source === 'fallback' && (
          <p className="text-xs text-mf-text-secondary">Not found on PATH — set the path to the binary above</p>
        )}
      </div>

      <ConfigConflictsWarning conflicts={conflicts} />

      {/* Toggles: systemPrompt + plan mode */}
      <ProviderToggles adapterId={adapterId} adapter={adapter} config={config} update={update} />

      {/* Default model picker */}
      <ModelDropdown
        adapterId={adapterId}
        value={config.defaultModel ?? 'default'}
        options={modelOptions}
        onChange={(v) => update({ defaultModel: v === 'default' ? '' : v })}
      />

      {/* Per-model tuning defaults */}
      {defaultModel && (
        <ProviderTuningDefaults adapterId={adapterId} model={defaultModel} config={config} onChange={update} />
      )}
      {adapterId === 'codex' && (
        <CodexTuningDefaults adapterId={adapterId} model={defaultModel} config={config} onChange={update} />
      )}

      <SessionModeRadio adapterId={adapterId} config={config} onChange={update} />
    </div>
  );
}

/** Toggles extracted to keep ProviderConfigForm under 50 lines per function. */
function ProviderToggles({
  adapterId,
  adapter,
  config,
  update,
}: {
  adapterId: string;
  adapter: AdapterInfo;
  config: ProviderConfig;
  update: (partial: ProviderConfigUpdate) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-mf-hover transition-colors">
        <input
          data-testid={`settings-${adapterId}-system-prompt-toggle`}
          type="checkbox"
          checked={config.systemPrompt === 'enabled'}
          onChange={(e) => update({ systemPrompt: e.target.checked ? 'enabled' : '' })}
          className="h-4 w-4 accent-mf-accent shrink-0 m-0"
          style={{ marginTop: 'calc((1.125rem - 1rem) / 2)' }}
        />
        <div className="flex-1">
          <span className="text-sm text-mf-text-primary">Enforce AskUserQuestion for agent questions</span>
          <p className="text-xs text-mf-text-secondary">
            Instructs the agent to use the interactive AskUserQuestion tool instead of asking in plain text.
          </p>
        </div>
      </label>

      {adapter.capabilities.planMode && (
        <label className="flex items-start gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-mf-hover transition-colors">
          <input
            data-testid={`settings-${adapterId}-plan-mode-toggle`}
            type="checkbox"
            checked={config.defaultPlanMode === 'true'}
            onChange={(e) => update({ defaultPlanMode: e.target.checked ? 'true' : 'false' })}
            className="h-4 w-4 accent-mf-accent shrink-0 m-0"
            style={{ marginTop: 'calc((1.125rem - 1rem) / 2)' }}
          />
          <div className="flex-1">
            <span className="text-sm text-mf-text-primary">Start in Plan Mode</span>
            <p className="text-xs text-mf-text-secondary">
              New chats begin with plan mode enabled. You can toggle it off mid-session.
            </p>
          </div>
        </label>
      )}
    </div>
  );
}
