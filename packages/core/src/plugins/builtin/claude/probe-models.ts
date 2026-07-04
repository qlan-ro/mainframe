import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { AdapterModel } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('claude-probe-models');
const PROBE_TIMEOUT_MS = 10_000;

interface CliModelInfo {
  value: string;
  displayName: string;
  description?: string;
  /** The concrete model id an alias (e.g. "default") currently resolves to. Per-entry, not payload-level. */
  resolvedModel?: string;
  supportedEffortLevels?: import('@qlan-ro/mainframe-types').EffortLevel[];
  supportsAdaptiveThinking?: boolean;
  supportsFastMode?: boolean;
}

// CLI descriptions look like "Opus 4.7 with 1M context · Most capable for complex work".
// The part before "·" is the model identity ("Opus 4.7 with 1M context"); the tail is marketing.
function extractIdentity(description: string | undefined): string | null {
  if (!description) return null;
  const firstChunk = description.split('·')[0]?.trim();
  return firstChunk || null;
}

export function mapModelInfo(info: CliModelInfo): AdapterModel {
  const identity = extractIdentity(info.description);
  let label = info.displayName;
  if (info.value === 'default') {
    // Drop the "with 1M context" tail for default — "Default" already implies top config.
    const bare = identity?.split(/\s+with\s+/i)[0]?.trim();
    label = bare ? `Default - ${bare}` : 'Default';
  } else if (identity) {
    label = identity;
  }
  const model: AdapterModel = { id: info.value, label };
  if (info.description) model.description = info.description;
  if (info.supportedEffortLevels?.length) {
    model.supportedEfforts = info.supportedEffortLevels;
    if (info.supportedEffortLevels.includes('xhigh')) model.supportsUltracode = true;
  }
  if (info.supportsFastMode) model.supportsFast = true;
  if (info.supportsAdaptiveThinking) model.supportsAdaptiveThinking = true;
  // The CLI exposes the tier-resolved default under value: "default" (e.g. Opus 4.7 on Max).
  if (info.value === 'default') model.isDefault = true;
  return model;
}

export interface ProbeResult {
  models: AdapterModel[];
  resolvedModel?: string;
}

/**
 * Parse the (possibly double-wrapped) `initialize` control_response.
 *
 * Live-verified against CLI 2.1.198 (2026-07-04): `resolvedModel` is NOT a sibling of the
 * top-level `models` array as originally assumed — each model entry carries its own
 * `resolvedModel`, e.g. `{ value: 'default', resolvedModel: 'claude-opus-4-8[1m]', ... }`.
 * We only need the "default" entry's, since that's the alias id whose real window
 * `enrichWithContextWindow` must infer.
 */
export function extractProbePayload(event: Record<string, unknown>): ProbeResult | null {
  if (event.type !== 'control_response') return null;
  const response = event.response as Record<string, unknown> | undefined;
  const payload = ((response?.response as Record<string, unknown>) ?? response) as Record<string, unknown> | undefined;
  const rawModels = payload?.models;
  if (!Array.isArray(rawModels)) return null;
  const models = (rawModels as CliModelInfo[]).map(mapModelInfo);
  const defaultEntry = (rawModels as CliModelInfo[]).find((m) => m.value === 'default');
  const resolvedModel = typeof defaultEntry?.resolvedModel === 'string' ? defaultEntry.resolvedModel : undefined;
  return { models, resolvedModel };
}

export function probeModels(executable: string): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ProbeResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };

    const child = spawn(
      executable,
      [
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
        '--verbose',
        '--permission-prompt-tool',
        'stdio',
      ],
      {
        cwd: homedir(),
        shell: process.platform === 'win32',
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          CLAUDECODE: undefined,
        },
      },
    );

    const timer = setTimeout(() => {
      log.warn('probe timed out');
      finish(null);
    }, PROBE_TIMEOUT_MS);

    child.on('error', (err) => {
      log.warn({ err }, 'probe spawn error');
      finish(null);
    });

    // CLI exited before sending models — return null (also fires after successful probe; settled guard handles it)
    child.on('exit', () => {
      finish(null);
    });

    child.stderr?.resume();

    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          const parsed = extractProbePayload(event);
          if (parsed) {
            log.info({ count: parsed.models.length }, 'probe received models');
            finish(parsed);
          }
        } catch {
          /* expected: CLI emits non-JSON lines (progress indicators, hook events, etc.) */
        }
      }
    });

    // Send initialize control_request
    const payload = {
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'initialize' },
    };
    child.stdin?.write(JSON.stringify(payload) + '\n');
  });
}
