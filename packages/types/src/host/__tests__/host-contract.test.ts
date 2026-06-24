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
} from '../host-contract.js';

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
