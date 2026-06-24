/**
 * Compile-time assertion: a structurally-complete object must satisfy HostBridge.
 * This file has no runtime behavior; tsc fails the build if the interface drifts.
 * It is excluded from the published dist via the rootDir/include of any test glob,
 * but is type-checked by `tsc` during build.
 */
import type {
  HostBridge,
  AppInfo,
  Platform,
  LogLevel,
  Bounds,
  Region,
  InspectResult,
  TerminalOpts,
  TerminalHandlers,
  TerminalHandle,
  Unsubscribe,
} from '../host-bridge.js';

// Exercise every payload type so a rename or removal breaks the build.
const _appInfo: AppInfo = { version: 'x', author: 'y', homedir: 'z' };
const _platform: Platform = 'macos';
const _level: LogLevel = 'info';
const _bounds: Bounds = { x: 0, y: 0, w: 1, h: 1 };
const _region: Region = { x: 0, y: 0, w: 1, h: 1 };
const _inspect: InspectResult = { tabId: 't', selector: null, rect: null, viewport: null };
const _termOpts: TerminalOpts = { id: 't', cwd: '/', cols: 80, rows: 24 };
const _termHandlers: TerminalHandlers = { onData: () => {}, onExit: () => {} };
void _appInfo;
void _platform;
void _level;
void _bounds;
void _region;
void _inspect;
void _termOpts;
void _termHandlers;

// A structurally-complete HostBridge must type-check.
declare const _bridge: HostBridge;
const _handle: Promise<TerminalHandle> = _bridge.terminal.create(_termOpts, _termHandlers);
const _unsubPromise: Promise<Unsubscribe> = _bridge.daemon.onStatus(() => {});
void _handle;
void _unsubPromise;
