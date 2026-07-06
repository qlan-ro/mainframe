/**
 * runTabForConfig — builds the Run tab for a launch config.
 *
 * Behaviors:
 *  - preview config → kind 'preview' + carries the resolved port
 *  - process config → kind 'console'
 *  - the tab id (used as the Tauri webview label) is sanitized: NO spaces
 */
import { describe, it, expect } from 'vitest';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { runTabForConfig } from '../run-tab-for-config';

const cfg = (over: Partial<LaunchConfiguration>): LaunchConfiguration =>
  ({ name: 'X', runtimeExecutable: 'pnpm', runtimeArgs: [], port: null, url: null, ...over }) as LaunchConfiguration;

describe('runTabForConfig', () => {
  it('preview config → kind preview, carries the port, title = config name', () => {
    const tab = runTabForConfig(cfg({ name: 'App Tauri Preview', preview: true, port: 5357 }));
    expect(tab.kind).toBe('preview');
    expect(tab.port).toBe(5357);
    expect(tab.title).toBe('App Tauri Preview');
    expect(tab.config).toBe('App Tauri Preview');
  });

  it('process config → kind console', () => {
    expect(runTabForConfig(cfg({ name: 'Core Daemon', preview: false })).kind).toBe('console');
  });

  it('sanitizes the tab id to a valid Tauri webview label (no spaces)', () => {
    const tab = runTabForConfig(cfg({ name: 'App Tauri Preview', preview: true, port: 5357 }));
    expect(tab.id).not.toMatch(/\s/);
    expect(tab.id.startsWith('preview-App_Tauri_Preview-')).toBe(true);
  });

  it('null port → undefined (not null)', () => {
    expect(runTabForConfig(cfg({ name: 'Setup Worktree', port: null })).port).toBeUndefined();
  });

  it('captures the launch scope on the tab when given', () => {
    const tab = runTabForConfig(cfg({ name: 'App Tauri Preview', preview: true }), 'proj-A:/wt/feat-x');
    expect(tab.scopeKey).toBe('proj-A:/wt/feat-x');
  });

  it('no scope → undefined scopeKey', () => {
    expect(runTabForConfig(cfg({ name: 'App Tauri Preview' })).scopeKey).toBeUndefined();
  });
});

describe('runTabForConfig — no remote gate', () => {
  it('preview config always produces a preview tab (remote parity — no null)', () => {
    const tab = runTabForConfig(cfg({ name: 'App Tauri Preview', preview: true, port: 5357 }));
    expect(tab.kind).toBe('preview');
    expect(tab.port).toBe(5357);
  });

  it('process config produces a console tab', () => {
    const tab = runTabForConfig(cfg({ name: 'Core Daemon', preview: false }));
    expect(tab.kind).toBe('console');
  });
});
