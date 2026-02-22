import type { Adapter, AdapterSession, AdapterModel, SessionOptions } from '@mainframe/types';
import { MockBaseSession } from './mock-session.js';

export class MockBaseAdapter implements Adapter {
  id = 'mock';
  name = 'Mock Adapter';

  private readonly sessionFactory?: (options: SessionOptions) => AdapterSession;

  constructor(sessionFactory?: (options: SessionOptions) => AdapterSession) {
    this.sessionFactory = sessionFactory;
  }

  async isInstalled(): Promise<boolean> {
    return true;
  }

  async getVersion(): Promise<string | null> {
    return '1.0.0';
  }

  async listModels(): Promise<AdapterModel[]> {
    return [];
  }

  killAll(): void {}

  createSession(options: SessionOptions): AdapterSession {
    return this.sessionFactory?.(options) ?? new MockBaseSession();
  }
}
