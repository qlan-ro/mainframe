import { describe, it, expect, vi } from 'vitest';
import { emitSurfaceIntent, onSurfaceIntent } from '../surface-intents';

describe('surface-intents bus', () => {
  it('calls a registered listener when an intent is emitted', () => {
    const listener = vi.fn();
    const unsub = onSurfaceIntent(listener);

    emitSurfaceIntent({ type: 'activate-surface', surface: 'files' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ type: 'activate-surface', surface: 'files' });
    unsub();
  });

  it('does not call a listener after it unsubscribes', () => {
    const listener = vi.fn();
    const unsub = onSurfaceIntent(listener);
    unsub();

    emitSurfaceIntent({ type: 'open-file', path: '/foo/bar.ts' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('calls all registered listeners', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = onSurfaceIntent(a);
    const unsubB = onSurfaceIntent(b);

    emitSurfaceIntent({ type: 'reveal-file', path: '/foo/bar.ts' });

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    unsubA();
    unsubB();
  });
});
