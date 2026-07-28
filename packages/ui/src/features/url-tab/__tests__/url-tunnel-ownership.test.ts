/**
 * Pure reducers over the URL-tab tunnel-ownership registry (#281, D10, AC12).
 *
 * `started: true` means this tab's own POST started the tunnel; `started: false`
 * means it merely adopted one another tab already owns. Only an owner's release
 * should ever stop a tunnel, and only when no other consumer remains on the port.
 */
import { describe, it, expect } from 'vitest';
import {
  addConsumer,
  clearConsumers,
  releaseConsumers,
  emptyConsumerState,
  type ConsumerRecord,
} from '../url-tunnel-ownership';

const rec = (port: number, started: boolean): ConsumerRecord => ({ port, started, daemonHttpPort: 31415 });

describe('releaseConsumers', () => {
  it('stops the port when the released tab started it and is the only consumer', () => {
    const state = addConsumer(emptyConsumerState, 'tab-1', rec(5173, true));
    const { next, stop } = releaseConsumers(state, ['tab-1']);
    expect(stop).toEqual([{ port: 5173, daemonHttpPort: 31415 }]);
    expect(next.byTab).toEqual({});
  });

  it('does not stop when the released tab only adopted the tunnel and is the only consumer', () => {
    const state = addConsumer(emptyConsumerState, 'tab-1', rec(5173, false));
    const { next, stop } = releaseConsumers(state, ['tab-1']);
    expect(stop).toEqual([]);
    expect(next.byTab).toEqual({});
  });

  it('does not stop while another consumer remains on the port', () => {
    let state = addConsumer(emptyConsumerState, 'tab-1', rec(5173, true));
    state = addConsumer(state, 'tab-2', rec(5173, false));
    const { next, stop } = releaseConsumers(state, ['tab-1']);
    expect(stop).toEqual([]);
    expect(next.byTab).toEqual({ 'tab-2': rec(5173, false) });
  });

  it('stops the port once, not twice, when both consumers are released together', () => {
    let state = addConsumer(emptyConsumerState, 'tab-1', rec(5173, true));
    state = addConsumer(state, 'tab-2', rec(5173, false));
    const { next, stop } = releaseConsumers(state, ['tab-1', 'tab-2']);
    expect(stop).toEqual([{ port: 5173, daemonHttpPort: 31415 }]);
    expect(next.byTab).toEqual({});
  });

  it('releasing an unknown tab id is a no-op and returns the same state reference', () => {
    const state = addConsumer(emptyConsumerState, 'tab-1', rec(5173, true));
    const { next, stop } = releaseConsumers(state, ['nope']);
    expect(stop).toEqual([]);
    expect(next).toBe(state);
  });
});

describe('clearConsumers', () => {
  it('empties the registry without producing any stops', () => {
    let state = addConsumer(emptyConsumerState, 'tab-1', rec(5173, true));
    state = addConsumer(state, 'tab-2', rec(8080, false));
    const cleared = clearConsumers(state);
    expect(cleared.byTab).toEqual({});
  });
});

describe('addConsumer — ownership persistence (D10, AC12)', () => {
  it('re-registering on the same port with started: false keeps started: true', () => {
    let state = addConsumer(emptyConsumerState, 'tab-1', rec(5173, true));
    state = addConsumer(state, 'tab-1', rec(5173, false));
    expect(state.byTab['tab-1']).toEqual(rec(5173, true));
  });

  it('re-registering on a different port takes the new started verbatim: true to false', () => {
    let state = addConsumer(emptyConsumerState, 'tab-1', rec(5173, true));
    state = addConsumer(state, 'tab-1', rec(8080, false));
    expect(state.byTab['tab-1']).toEqual(rec(8080, false));
  });

  it('re-registering on a different port takes the new started verbatim: false to true', () => {
    let state = addConsumer(emptyConsumerState, 'tab-1', rec(5173, false));
    state = addConsumer(state, 'tab-1', rec(8080, true));
    expect(state.byTab['tab-1']).toEqual(rec(8080, true));
  });
});
