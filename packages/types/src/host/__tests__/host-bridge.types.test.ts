import { describe, it, expect } from 'vitest';
import type { HostBridge, PreviewHandle, PreviewOpts } from '../host-bridge.js';

describe('HostBridge preview contract shape', () => {
  it('preview exposes mount + clearSession (compile-time)', () => {
    // Compile-time structural assertions: these fail tsc if the shape drifts.
    const assertShape = (h: HostBridge): void => {
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
    void assertShape;
    expect(true).toBe(true);
  });
});
