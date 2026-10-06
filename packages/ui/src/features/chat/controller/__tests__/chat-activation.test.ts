// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ChatActivation, type ChatActivationHost } from '../chat-activation';

function host(
  over: Partial<ChatActivationHost> = {},
): ChatActivationHost & { reactivatePlane: ReturnType<typeof vi.fn>; detachPlane: ReturnType<typeof vi.fn> } {
  return {
    isLocalOnly: () => false,
    isReady: () => true,
    getClient: () => ({}) as never,
    load: vi.fn(async () => undefined),
    reactivatePlane: vi.fn(async () => undefined),
    detachPlane: vi.fn(),
    ...over,
  } as never;
}

describe('ChatActivation — split-zone holds', () => {
  it('a hold attaches the plane for a chat that is not the main thread', () => {
    const h = host();
    const activation = new ChatActivation(h);
    const release = activation.hold();
    expect(activation.isActive).toBe(true);
    expect(h.reactivatePlane).toHaveBeenCalledTimes(1);
    release();
    expect(activation.isActive).toBe(false);
    expect(h.detachPlane).toHaveBeenCalledTimes(1);
  });

  it('losing main-thread status while a zone holds it keeps the plane attached', () => {
    const h = host();
    const activation = new ChatActivation(h);
    activation.setActive(true);
    const release = activation.hold();
    activation.setActive(false);
    expect(activation.isActive).toBe(true);
    expect(h.detachPlane).not.toHaveBeenCalled();
    release();
    expect(h.detachPlane).toHaveBeenCalledTimes(1);
  });

  it('flag + hold attach once, and a double release is idempotent', () => {
    const h = host();
    const activation = new ChatActivation(h);
    activation.setActive(true);
    const release = activation.hold();
    expect(h.reactivatePlane).toHaveBeenCalledTimes(1);
    release();
    release();
    expect(activation.isActive).toBe(true);
    expect(h.detachPlane).not.toHaveBeenCalled();
  });
});
