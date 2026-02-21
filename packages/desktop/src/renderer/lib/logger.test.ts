import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger } from './logger';

describe('createLogger', () => {
  const mockLog = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (window as { mainframe?: unknown }).mainframe = { log: mockLog };
  });

  it('info forwards to IPC', () => {
    const log = createLogger('test-module');
    log.info('hello', { key: 'value' });
    expect(mockLog).toHaveBeenCalledWith('info', 'test-module', 'hello', { key: 'value' });
  });

  it('warn forwards to IPC', () => {
    const log = createLogger('test-module');
    log.warn('oops');
    expect(mockLog).toHaveBeenCalledWith('warn', 'test-module', 'oops', undefined);
  });

  it('error forwards to IPC', () => {
    const log = createLogger('test-module');
    log.error('failure', { err: 'details' });
    expect(mockLog).toHaveBeenCalledWith('error', 'test-module', 'failure', { err: 'details' });
  });

  it('debug forwards to IPC', () => {
    const log = createLogger('test-module');
    log.debug('verbose');
    expect(mockLog).toHaveBeenCalledWith('debug', 'test-module', 'verbose', undefined);
  });

  it('does not throw when window.mainframe is absent', () => {
    (window as { mainframe?: unknown }).mainframe = undefined;
    const log = createLogger('test-module');
    expect(() => log.info('safe')).not.toThrow();
  });
});
