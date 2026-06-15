import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdapterInfo, ProviderConfig, ProviderConfigUpdate } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '../../../../store/settings';
import { updateProviderSettings, getConfigConflicts } from '../../../../lib/api/settings';
import { SessionModeRadio } from './SessionModeRadio';
import { ConfigConflictsWarning } from './ConfigConflictsWarning';
import { ModelDropdown } from './ModelDropdown';
import { ProviderTuningDefaults } from './ProviderTuningDefaults';
import { CodexTuningDefaults } from './CodexTuningDefaults';
import { Switch } from '../../../../components/ui/switch';

const EMPTY_CONFIG: ProviderConfig = {};

interface ProviderConfigFormProps {
  port: number;
  adapterId: string;
  label: string;
  adapter: AdapterInfo;
}

/** Optimistic update: applies the patch locally then PUTs to daemon.
 *  Reads live state from the store (not the render-time closure) so rapid
 *  successive calls compose correctly rather than both merging into the same
 *  stale snapshot.
 *  The '' sentinel clears the key so the control falls back to the inherited default. */
function applyUpdate(port: number, adapterId: string, partial: ProviderConfigUpdate): void {
  const current = useSettingsStore.getState().providers[adapterId] ?? EMPTY_CONFIG;
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(partial)) {
    if (v === '') delete next[k];
    else next[k] = v;
  }
  useSettingsStore.getState().setProviderConfig(adapterId, next as ProviderConfig);
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

  // applyUpdate reads live state internally — no need to close over config.
  const update = useCallback(
    (partial: ProviderConfigUpdate) => {
      applyUpdate(port, adapterId, partial);
    },
    [port, adapterId],
  );

  function handleExecPathBlur() {
    const trimmed = execPath.trim();
    if (trimmed !== (config.executablePath ?? '')) {
      // '' is the daemon clear sentinel — JSON.stringify keeps it (unlike undefined).
      update({ executablePath: trimmed });
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
        <label className="text-label text-muted-foreground">Executable Path</label>
        <input
          data-testid={`settings-${adapterId}-executable-path-input`}
          type="text"
          value={execPath}
          onChange={(e) => setExecPath(e.target.value)}
          onBlur={handleExecPathBlur}
          placeholder={label.toLowerCase()}
          className="w-full px-3 py-1.5 text-body bg-card text-foreground border border-mf-border rounded-md focus:outline-none focus:border-primary"
        />
        {config.resolvedExecutable?.source === 'fallback' && (
          <p className="text-label text-muted-foreground">Not found on PATH — set the path to the binary above</p>
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
      <label className="flex items-start gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors">
        <Switch
          data-testid={`settings-${adapterId}-system-prompt-toggle`}
          checked={config.systemPrompt === 'enabled'}
          onCheckedChange={(checked) => update({ systemPrompt: checked ? 'enabled' : '' })}
          className="mt-0.5 shrink-0"
        />
        <div className="flex-1">
          <span className="text-body text-foreground">Enforce AskUserQuestion for agent questions</span>
          <p className="text-label text-muted-foreground">
            Instructs the agent to use the interactive AskUserQuestion tool instead of asking in plain text.
          </p>
        </div>
      </label>

      {adapter.capabilities.planMode && (
        <label className="flex items-start gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors">
          <Switch
            data-testid={`settings-${adapterId}-plan-mode-toggle`}
            checked={config.defaultPlanMode === 'true'}
            onCheckedChange={(checked) => update({ defaultPlanMode: checked ? 'true' : 'false' })}
            className="mt-0.5 shrink-0"
          />
          <div className="flex-1">
            <span className="text-body text-foreground">Start in Plan Mode</span>
            <p className="text-label text-muted-foreground">
              New chats begin with plan mode enabled. You can toggle it off mid-session.
            </p>
          </div>
        </label>
      )}
    </div>
  );
}
