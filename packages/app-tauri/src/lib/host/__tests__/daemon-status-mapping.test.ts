import { describe, it, expect } from 'vitest';
import { mapDaemonStatus } from '../tauri-adapter';

describe('mapDaemonStatus — legacy string → DaemonStatus enum', () => {
  it('maps not_started → initializing', () => {
    expect(mapDaemonStatus('not_started')).toBe('initializing');
  });
  it('maps starting → starting', () => {
    expect(mapDaemonStatus('starting')).toBe('starting');
  });
  it('maps started:pid=4242 → starting', () => {
    expect(mapDaemonStatus('started:pid=4242')).toBe('starting');
  });
  it('maps running:4242 → ready', () => {
    expect(mapDaemonStatus('running:4242')).toBe('ready');
  });
  it('maps ready → ready', () => {
    expect(mapDaemonStatus('ready')).toBe('ready');
  });
  it('maps exited → stopped', () => {
    expect(mapDaemonStatus('exited')).toBe('stopped');
  });
  it('maps error:boom → unavailable', () => {
    expect(mapDaemonStatus('error:boom')).toBe('unavailable');
  });
  it('maps an unknown value → unavailable', () => {
    expect(mapDaemonStatus('wat')).toBe('unavailable');
  });
});
