import { describe, it, expect } from 'vitest';
import {
  PlatformSchema,
  DaemonStatusSchema,
  TerminalCreateOptsSchema,
  AppInfoSchema,
  FilePathSchema,
  NotifySchema,
  ClearSessionSchema,
  LogRecordSchema,
  PresenceStateSchema,
  PresenceSchema,
  UpdateStatusSchema,
} from '../host-contract.js';
import { DaemonMetaSchema } from '../daemon-target.js';
import type { HostBridge, PreviewHandle, PreviewOpts } from '../host-bridge.js';

describe('host-contract schemas', () => {
  it('PlatformSchema accepts known platforms and rejects others', () => {
    expect(PlatformSchema.parse('macos')).toBe('macos');
    expect(() => PlatformSchema.parse('freebsd')).toThrow();
  });

  it('DaemonStatusSchema accepts the closed vocabulary', () => {
    expect(DaemonStatusSchema.parse('ready')).toBe('ready');
    expect(DaemonStatusSchema.parse('initializing')).toBe('initializing');
    expect(() => DaemonStatusSchema.parse('green')).toThrow();
  });

  it('TerminalCreateOptsSchema requires id/cwd/cols/rows', () => {
    expect(TerminalCreateOptsSchema.parse({ id: 't1', cwd: '/tmp', cols: 80, rows: 24 })).toEqual({
      id: 't1',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    });
    expect(() => TerminalCreateOptsSchema.parse({ id: 't1', cwd: '/tmp' })).toThrow();
  });

  it('AppInfoSchema requires version/author/homedir', () => {
    expect(AppInfoSchema.parse({ version: '1.0', author: 'q', homedir: '/h' })).toEqual({
      version: '1.0',
      author: 'q',
      homedir: '/h',
    });
    expect(AppInfoSchema.safeParse({ author: 'q', homedir: '/h' }).success).toBe(false);
  });

  it('FilePathSchema rejects empty strings', () => {
    expect(FilePathSchema.parse('/x')).toBe('/x');
    expect(() => FilePathSchema.parse('')).toThrow();
  });

  it('NotifySchema makes body optional', () => {
    expect(NotifySchema.parse({ title: 'hi' })).toEqual({ title: 'hi' });
    expect(NotifySchema.parse({ title: 'hi', body: 'there' })).toEqual({ title: 'hi', body: 'there' });
  });

  it('ClearSessionSchema requires projectId', () => {
    expect(ClearSessionSchema.parse({ projectId: 'p1' })).toEqual({ projectId: 'p1' });
    expect(() => ClearSessionSchema.parse({})).toThrow();
  });

  it('LogRecordSchema validates level + module + message', () => {
    expect(LogRecordSchema.parse({ level: 'info', module: 'm', message: 'msg' })).toMatchObject({
      level: 'info',
      module: 'm',
      message: 'msg',
    });
    expect(() => LogRecordSchema.parse({ level: 'verbose', module: 'm', message: 'msg' })).toThrow();
  });
});

describe('PresenceSchema', () => {
  it.each([
    ['active', 'active'],
    ['idle', 'idle'],
  ] as const)('PresenceStateSchema accepts %s', (input, expected) => {
    expect(PresenceStateSchema.parse(input)).toBe(expected);
  });

  it('PresenceSchema accepts a full presence object', () => {
    expect(PresenceSchema.parse({ state: 'idle' })).toEqual({ state: 'idle' });
  });

  it('PresenceStateSchema rejects other states', () => {
    expect(() => PresenceStateSchema.parse('away')).toThrow();
  });
});

describe('UpdateStatusSchema', () => {
  it.each([
    [{ state: 'checking' }, { state: 'checking' }],
    [
      { state: 'available', version: '1.2.3' },
      { state: 'available', version: '1.2.3' },
    ],
    [
      { state: 'downloading', percent: 42 },
      { state: 'downloading', percent: 42 },
    ],
    [
      { state: 'downloaded', version: '9.9.9' },
      { state: 'downloaded', version: '9.9.9' },
    ],
    [{ state: 'not-available' }, { state: 'not-available' }],
    [
      { state: 'error', message: 'boom' },
      { state: 'error', message: 'boom' },
    ],
  ])('accepts the %j variant', (input, expected) => {
    expect(UpdateStatusSchema.parse(input)).toEqual(expected);
  });

  it('rejects available without a version', () => {
    expect(() => UpdateStatusSchema.parse({ state: 'available' })).toThrow();
  });

  it('rejects an unknown state', () => {
    expect(() => UpdateStatusSchema.parse({ state: 'paused' })).toThrow();
  });
});

describe('DaemonMetaSchema (host/daemon-target.ts)', () => {
  it.each([
    ['accepts a valid DaemonMeta', { id: 'studio', kind: 'remote', label: 'Studio', host: 'studio.example.com' }, true],
    ['rejects a payload missing id', { kind: 'remote', label: 'Studio', host: 'studio.example.com' }, false],
    [
      'rejects a payload with invalid kind',
      { id: 'studio', kind: 'bogus', label: 'Studio', host: 'studio.example.com' },
      false,
    ],
    ['rejects a payload missing required fields', { id: 'studio' }, false],
  ])('%s', (_name, payload, shouldSucceed) => {
    expect(DaemonMetaSchema.safeParse(payload).success).toBe(shouldSucceed);
  });
});

// Type-level (compile-time only): HostBridge preview contract shape. Never
// invoked at runtime — a shape drift fails `tsc`, not this test run.
const _assertPreviewShape = (h: HostBridge): void => {
  const handle: PreviewHandle = h.preview.mount(document.createElement('div'), 'http://x', {} as PreviewOpts);
  void handle.setVisible;
  void handle.navigate;
  void handle.capture;
  void handle.startInspect;
  void handle.onInspect;
  void handle.refit;
  void handle.setDevice;
  void handle.destroy;
  void h.preview.clearSession('p');
};
void _assertPreviewShape;
