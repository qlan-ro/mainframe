/**
 * deriveLaunchRunControl — the toolbar run/stop button's state derivation.
 *
 * The control must reflect the ACTUAL running state of the scope, not just the
 * selected config: a config started outside the toolbar (boot reconcile, the
 * Run-surface add-menu, or after the user re-selected a different row) must
 * still surface its Stop control here. This is the fix for todo #206 —
 * "stop button missing / doubled green ▶": the button was deriving `running`
 * from the selected config alone, so a running non-selected config left the
 * button a green Play (no Stop, and a second green ▶ beside the Run-surface
 * glyph).
 */
import { describe, it, expect } from 'vitest';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { deriveLaunchRunControl, isLaunchStatusLive, NO_CONFIGS_LABEL } from '../derive-launch-control';

const cfg = (name: string, over: Partial<LaunchConfiguration> = {}): LaunchConfiguration =>
  ({ name, runtimeExecutable: 'pnpm', runtimeArgs: [], port: null, url: null, ...over }) as LaunchConfiguration;

const A = cfg('Setup Worktree');
const B = cfg('Core Daemon');
const C = cfg('Preview', { preview: true });
const CONFIGS = [A, B, C];

const statuses = (s: Record<string, LaunchProcessStatus>) => s;

describe('deriveLaunchRunControl', () => {
  it('no configs → empty mode, no target, placeholder label', () => {
    const ctrl = deriveLaunchRunControl([], {}, null);
    expect(ctrl.mode).toBe('empty');
    expect(ctrl.target).toBeUndefined();
    expect(ctrl.label).toBe(NO_CONFIGS_LABEL);
  });

  it('configs present, none running → idle, targets the selected config', () => {
    const ctrl = deriveLaunchRunControl(CONFIGS, {}, 'Core Daemon');
    expect(ctrl.mode).toBe('idle');
    expect(ctrl.target).toBe(B);
    expect(ctrl.label).toBe('Core Daemon');
  });

  it('null selection falls back to the first config', () => {
    const ctrl = deriveLaunchRunControl(CONFIGS, {}, null);
    expect(ctrl.mode).toBe('idle');
    expect(ctrl.target).toBe(A);
    expect(ctrl.label).toBe('Setup Worktree');
  });

  it('the selected config is running → running mode, targets it', () => {
    const ctrl = deriveLaunchRunControl(CONFIGS, statuses({ 'Core Daemon': 'running' }), 'Core Daemon');
    expect(ctrl.mode).toBe('running');
    expect(ctrl.target).toBe(B);
    expect(ctrl.label).toBe('Core Daemon');
  });

  it('a "starting" config counts as live (running mode)', () => {
    const ctrl = deriveLaunchRunControl(CONFIGS, statuses({ 'Setup Worktree': 'starting' }), 'Setup Worktree');
    expect(ctrl.mode).toBe('running');
    expect(ctrl.target).toBe(A);
  });

  // ── the todo #206 regression ────────────────────────────────────────────────
  it('a NON-selected config is running → running mode, targets the RUNNING config (not the idle selection)', () => {
    // Selected = "Setup Worktree" (stopped), but "Preview" is actually running.
    const ctrl = deriveLaunchRunControl(CONFIGS, statuses({ Preview: 'running' }), 'Setup Worktree');
    expect(ctrl.mode).toBe('running');
    expect(ctrl.target).toBe(C);
    expect(ctrl.label).toBe('Preview');
  });

  it('failed / stopped statuses are NOT live (idle mode)', () => {
    const ctrl = deriveLaunchRunControl(
      CONFIGS,
      statuses({ Preview: 'failed', 'Core Daemon': 'stopped' }),
      'Core Daemon',
    );
    expect(ctrl.mode).toBe('idle');
    expect(ctrl.target).toBe(B);
  });

  it('multiple running including the selected → prefers the selected as the stop target', () => {
    const ctrl = deriveLaunchRunControl(
      CONFIGS,
      statuses({ 'Setup Worktree': 'running', 'Core Daemon': 'running' }),
      'Core Daemon',
    );
    expect(ctrl.mode).toBe('running');
    expect(ctrl.target).toBe(B);
  });

  it('multiple running excluding the selected → targets the first running config in list order', () => {
    const ctrl = deriveLaunchRunControl(
      CONFIGS,
      statuses({ 'Core Daemon': 'running', Preview: 'running' }),
      'Setup Worktree',
    );
    expect(ctrl.mode).toBe('running');
    expect(ctrl.target).toBe(B);
  });

  it('stale selection not in configs, another config running → targets the running config', () => {
    const ctrl = deriveLaunchRunControl(CONFIGS, statuses({ Preview: 'running' }), 'deleted-config');
    expect(ctrl.mode).toBe('running');
    expect(ctrl.target).toBe(C);
  });
});

// The Run-surface tab strip and the toolbar picker row both need the same
// "is this config live?" check per-config (todo #206 part 2). Reuse this rather
// than re-hardcoding the running/starting literals.
describe('isLaunchStatusLive', () => {
  it('running and starting are live', () => {
    expect(isLaunchStatusLive('running')).toBe(true);
    expect(isLaunchStatusLive('starting')).toBe(true);
  });

  it('stopped / failed / undefined are not live', () => {
    expect(isLaunchStatusLive('stopped')).toBe(false);
    expect(isLaunchStatusLive('failed')).toBe(false);
    expect(isLaunchStatusLive(undefined)).toBe(false);
  });
});
