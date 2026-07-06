// @vitest-environment node
/**
 * Release-safety invariant for the Tauri configuration.
 *
 * `window.__TAURI__` (withGlobalTauri) widens the IPC attack surface when
 * injected into production builds. The base config must keep it off; a
 * dev-only overlay re-enables it solely for the MCP bridge during development.
 *
 * The Tauri shell (`src-tauri/`) lives in the sibling `@qlan-ro/mainframe-app-tauri`
 * package, not here — moved out in the 2026-06-25 renderer extraction
 * (`packages/app-tauri/src` -> `packages/ui`). Reach across the package boundary
 * to the real config files rather than duplicating/relocating this test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

const BASE_CONFIG_PATH = path.resolve(__dirname, '../../../app-tauri/src-tauri/tauri.conf.json');
const DEV_OVERLAY_PATH = path.resolve(__dirname, '../../../app-tauri/src-tauri/tauri.dev.conf.json');

describe('tauri config release safety', () => {
  it('base config does not inject window.__TAURI__ (withGlobalTauri is false)', () => {
    const raw = readFileSync(BASE_CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw) as { app?: { withGlobalTauri?: boolean } };
    expect(config.app?.withGlobalTauri).toBe(false);
  });

  it('dev overlay exists and re-enables withGlobalTauri for development', () => {
    const exists = existsSync(DEV_OVERLAY_PATH);
    expect(exists, `dev overlay not found at ${DEV_OVERLAY_PATH}`).toBe(true);

    const raw = readFileSync(DEV_OVERLAY_PATH, 'utf8');
    const overlay = JSON.parse(raw) as { app?: { withGlobalTauri?: boolean } };
    expect(overlay.app?.withGlobalTauri).toBe(true);
  });
});
