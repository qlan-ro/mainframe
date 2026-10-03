import { expect, it } from 'vitest';
import type { MainframeCapabilities } from '@qlan-ro/mainframe-types';
import { AcpSessionAttachment } from '../acp-session-attachment';
import { makeHost } from './acp-attachment-support';
import { makeFakeAcpClient } from './acp-test-kit';

function observable(flags: MainframeCapabilities | null) {
  let snapshot = flags;
  const listeners = new Set<(value: MainframeCapabilities | null) => void>();
  const captured: Array<(value: MainframeCapabilities | null) => void> = [];
  const client = {
    ...makeFakeAcpClient(),
    get mainframeCapabilities() {
      return snapshot;
    },
    onCapabilitiesChanged(listener: (value: MainframeCapabilities | null) => void) {
      listeners.add(listener);
      captured.push(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    client,
    listeners,
    captured,
    replace(value: MainframeCapabilities | null, notify = true) {
      snapshot = value;
      if (notify) listeners.forEach((listener) => listener(value));
    },
  };
}
const current = { authoritativeItemStreaming: true };

it('keeps capability subscription during dormancy/reactivation without extra resume traffic', async () => {
  const port = observable(current);
  const bundle = makeHost();
  const attachment = new AcpSessionAttachment(bundle.host);
  await attachment.attach(port.client);
  attachment.detach();
  expect(port.listeners.size).toBe(1);
  const resumes = port.client.resumeCalls.length;
  port.replace({ authoritativeItemStreaming: false });
  expect(bundle.dispatch).toHaveBeenLastCalledWith({ type: 'capabilities.updated', authoritativeItemStreaming: false });
  expect(port.client.resumeCalls).toHaveLength(resumes);
  await attachment.reactivate(port.client);
  expect(port.listeners.size).toBe(1);
  attachment.dispose();
  expect(port.listeners.size).toBe(0);
});
it('refreshes same-client snapshots and suppresses redundant state events', () => {
  const port = observable(current);
  const bundle = makeHost();
  const attachment = new AcpSessionAttachment(bundle.host);
  attachment.bindClient(port.client);
  attachment.bindClient(port.client);
  port.replace(current);
  expect(bundle.dispatch).toHaveBeenCalledTimes(1);
  port.replace(null, false);
  attachment.bindClient(port.client);
  expect(bundle.dispatch).toHaveBeenLastCalledWith({ type: 'capabilities.updated', authoritativeItemStreaming: false });
  expect(port.listeners.size).toBe(1);
  attachment.dispose();
});
it('resets support on a different binding and ignores callbacks retained from replaced or disposed bindings', () => {
  const first = observable(current);
  const second = observable(null);
  const bundle = makeHost();
  const attachment = new AcpSessionAttachment(bundle.host);
  attachment.bindClient(first.client);
  attachment.bindClient(second.client);
  expect(first.listeners.size).toBe(0);
  expect(bundle.dispatch).toHaveBeenLastCalledWith({ type: 'capabilities.updated', authoritativeItemStreaming: false });
  bundle.dispatch.mockClear();
  first.captured[0]!(current);
  expect(bundle.dispatch).not.toHaveBeenCalled();
  attachment.dispose();
  second.captured[0]!(current);
  expect(bundle.dispatch).not.toHaveBeenCalled();
});
it('uses snapshots for older client ports without an observable and accepts only literal true', () => {
  const bundle = makeHost();
  const attachment = new AcpSessionAttachment(bundle.host);
  attachment.bindClient(makeFakeAcpClient({ capabilities: current }));
  attachment.bindClient(makeFakeAcpClient({ capabilities: { replayComplete: true, itemCreationMarkers: true } }));
  expect(bundle.dispatch.mock.calls.map(([event]) => event)).toEqual([
    { type: 'capabilities.updated', authoritativeItemStreaming: true },
    { type: 'capabilities.updated', authoritativeItemStreaming: false },
  ]);
  attachment.dispose();
});
