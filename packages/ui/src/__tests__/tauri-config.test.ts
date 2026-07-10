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
import viteConfig from '../../vite.config';

const BASE_CONFIG_PATH = path.resolve(__dirname, '../../../app-tauri/src-tauri/tauri.conf.json');
const DEV_OVERLAY_PATH = path.resolve(__dirname, '../../../app-tauri/src-tauri/tauri.dev.conf.json');
const MAIN_CAPABILITY_PATH = path.resolve(__dirname, '../../../app-tauri/src-tauri/capabilities/main.json');

type PermissionEntry = string | { identifier: string; allow?: Array<{ url?: string }> };

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

  it('allows loopback daemon ports configured at runtime', () => {
    const raw = readFileSync(BASE_CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw) as { app?: { security?: { csp?: string } } };
    expect(config.app?.security?.csp).toContain('http://127.0.0.1:*');
    expect(config.app?.security?.csp).toContain('ws://127.0.0.1:*');
  });

  it('uses relative asset paths so packaged desktop shells can load the renderer', () => {
    const config = typeof viteConfig === 'function' ? viteConfig({ mode: 'production', command: 'build' }) : viteConfig;
    expect(config.base).toBe('./');
  });

  it('uses a Vite target supported by the current desktop build toolchain', () => {
    const config = typeof viteConfig === 'function' ? viteConfig({ mode: 'production', command: 'build' }) : viteConfig;
    expect(config.build?.target).toBe('es2020');
  });
});

describe('opener capability scope (transcript external links)', () => {
  // `opener:allow-open-url` as a bare string enables the command with NO scope,
  // so tauri-plugin-opener rejects every URL ("Not allowed to open url …") and
  // clicking a transcript link silently does nothing. The permission MUST carry
  // an `allow` URL scope. Keep the scheme list in sync with EXTRA_SAFE_PROTOCOLS
  // in features/chat/parts/markdown-url-transform.ts.
  function openUrlScope(): string[] {
    const raw = readFileSync(MAIN_CAPABILITY_PATH, 'utf8');
    const cap = JSON.parse(raw) as { permissions: PermissionEntry[] };
    const entry = cap.permissions.find(
      (p): p is { identifier: string; allow?: Array<{ url?: string }> } =>
        typeof p === 'object' && p.identifier === 'opener:allow-open-url',
    );
    expect(entry, 'opener:allow-open-url must be a scoped object, not a bare string').toBeDefined();
    return (entry!.allow ?? []).map((s) => s.url).filter((u): u is string => typeof u === 'string');
  }

  it('grants an http/https URL scope so external links open in the system browser', () => {
    const urls = openUrlScope();
    expect(urls).toContain('http://*');
    expect(urls).toContain('https://*');
  });

  it('grants the app-protocol schemes that the markdown renderer linkifies', () => {
    const urls = openUrlScope();
    for (const scheme of ['slack', 'vscode', 'cursor', 'zed', 'figma', 'linear', 'notion']) {
      expect(urls).toContain(`${scheme}://*`);
    }
  });
});
