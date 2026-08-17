// @vitest-environment jsdom
/**
 * Runtime detection, and the preview carve-out in particular.
 *
 * A Mainframe UI can end up loaded inside Mainframe's own preview webview —
 * previewing a dev server that happens to be Mainframe. Tauri injects its
 * internals there too, so without the carve-out that nested app picks the Tauri
 * adapter, asks for a daemon port the preview capability never granted, and
 * hangs on the connecting overlay.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isTauriRuntime } from '../detect';

type Mutable = Record<string, unknown>;

afterEach(() => {
  delete (window as unknown as Mutable).__TAURI_INTERNALS__;
  delete (window as unknown as Mutable).__mfPreviewWebview;
});

describe('isTauriRuntime', () => {
  it('is false in a plain browser', () => {
    expect(isTauriRuntime()).toBe(false);
  });

  it('is true in the app webview', () => {
    (window as unknown as Mutable).__TAURI_INTERNALS__ = {};

    expect(isTauriRuntime()).toBe(true);
  });

  it('is false in a preview webview, which carries the internals too', () => {
    (window as unknown as Mutable).__TAURI_INTERNALS__ = {};
    (window as unknown as Mutable).__mfPreviewWebview = true;

    expect(isTauriRuntime()).toBe(false);
  });

  it('stays false in a preview even if the flag is set falsy — presence is the signal', () => {
    (window as unknown as Mutable).__TAURI_INTERNALS__ = {};
    (window as unknown as Mutable).__mfPreviewWebview = false;

    expect(isTauriRuntime()).toBe(false);
  });
});
