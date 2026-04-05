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
  supportsEffort?: boolean;
  supportsFastMode?: boolean;
  supportsAutoMode?: boolean;
}

function mapModelInfo(info: CliModelInfo): AdapterModel {
  const model: AdapterModel = { id: info.value, label: info.displayName };
  if (info.supportsEffort) model.supportsEffort = true;
  if (info.supportsFastMode) model.supportsFastMode = true;
  if (info.supportsAutoMode) model.supportsAutoMode = true;
  return model;
}

export function probeModels(executable: string): Promise<AdapterModel[] | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: AdapterModel[] | null) => {
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

    child.on('exit', () => {
      finish(null);
    });

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
          if (event.type === 'control_response' && event.response?.models) {
            const models = (event.response.models as CliModelInfo[]).map(mapModelInfo);
            log.info({ count: models.length }, 'probe received models');
            finish(models);
          }
        } catch {
          // skip non-JSON lines
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
