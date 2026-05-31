// packages/e2e/plugins/mock-cli/src/adapter.ts
import type { Adapter, AdapterModel, AdapterSession, SessionOptions } from '@qlan-ro/mainframe-types';
import { ReplaySession } from './session';

export class MockCliAdapter implements Adapter {
  id = 'mock-cli';
  name = 'Mock CLI';
  readonly capabilities = { planMode: true };
  private readonly indexByKey = new Map<string, number>();

  async isInstalled(): Promise<boolean> {
    return true;
  }
  async getVersion(): Promise<string | null> {
    return '0.1.0';
  }
  async listModels(): Promise<AdapterModel[]> {
    return [{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', isDefault: true }];
  }
  killAll(): void {}

  createSession(options: SessionOptions): AdapterSession {
    const dir = process.env['E2E_RECORDINGS_DIR'];
    if (!dir) throw new Error('mock-cli requires E2E_RECORDINGS_DIR');
    const key = process.env['E2E_RECORDING_KEY'] ?? 'session';
    const index = this.indexByKey.get(key) ?? 0;
    this.indexByKey.set(key, index + 1);
    return new ReplaySession(options, dir, key, index);
  }
}
