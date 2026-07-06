/**
 * §settings — the Settings dialog (5 panes: General/Providers/Notifications/Remote Access/About).
 *
 * Spec: docs/plans/2026-07-03-tauri-e2e-test-plan.md #26 (Cluster D).
 * UI-only for chrome/general/notifications/providers/about/remote-access (no agent turn). The
 * tuning-inheritance scenario needs one mock-cli chat (skips gracefully if the adapter is absent).
 *
 * Source: packages/ui/src/features/settings/{SettingsDialog,SettingsSidebar,SettingsContent,
 * settings-tabs}, panes/general/{GeneralPane,AppearanceControls}, panes/notifications/NotificationsPane,
 * panes/about/AboutPane, panes/providers/{ProvidersPane,ProviderConfigForm,ModelDropdown,
 * SessionModeRadio,ProviderTuningDefaults}, panes/remote-access/{RemoteAccessPane,TunnelControl,
 * QuickTunnelSection,NamedTunnelSection,DevicesSection,PairingSection}.
 *
 * Testid reference (verified against source):
 *   sidebar-settings-button              — layout/SidebarHeader.tsx opens the dialog
 *   settings-dialog / settings-dialog-close
 *   settings-nav-<tab>                   — tab ids: general/providers/notifications/remote-access/about
 *                                           (no `settings-nav-keybindings` — S4 dropped the pane)
 *   settings-nav-provider-<adapterId>    — SettingsSidebar ProviderSubItems (providers tab only)
 *   settings-pane-<tab>                  — SettingsContent per-pane root
 *   settings-pane-provider-<adapterId>   — ProviderConfigForm root
 *   settings-provider-header-<adapterId> — ProvidersPane ProviderHeader
 *   settings-appearance-<axis>-<id>      — AppearanceControls PickerRow buttons
 *                                           (axes: ui-scale/mode/scheme/window-style)
 *   settings-worktree-dir-input / settings-worktree-dir-save
 *   settings-notify-<key>-toggle         — NotificationsPane ToggleRow switches
 *   settings-<adapterId>-executable-path-input
 *   settings-<adapterId>-system-prompt-toggle / settings-<adapterId>-plan-mode-toggle
 *   settings-<adapterId>-model-dropdown-trigger / settings-<adapterId>-model-option-<id>
 *   settings-<adapterId>-mode-option-<default|acceptEdits|yolo>
 *   settings-<adapterId>-default-effort / settings-<adapterId>-default-effort-option-<id|inherit>
 *   settings-about-version / settings-about-author / settings-about-homedir
 *   settings-remote-access-{named-tunnel,quick-tunnel,devices,pairing}-section
 *   named-tunnel-token-input / named-tunnel-url-input / named-tunnel-save
 *   quick-tunnel-toggle
 *   composer-model-select / composer-model-select-option-<id> / composer-effort-select /
 *   composer-effort-select-option-<id>   — packages/ui/src/features/chat/composer/config-toolbar
 *
 * NOT found in source (noted, not asserted): AboutPane renders no copy buttons for
 * version/author/homedir (the plan text mentions "copy buttons" but only remote-access rows
 * use the shared CopyButton — see report).
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';

type SettingsTab = 'general' | 'providers' | 'notifications' | 'remote-access' | 'about';

/** Open the dialog via the deterministic sidebar-button path (⌘, covered separately). */
async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('sidebar-settings-button').click();
  await page.getByTestId('settings-dialog').waitFor({ timeout: 10_000 });
}

/** Close the dialog if still open, so each test starts the next one clean. */
async function closeSettings(page: Page): Promise<void> {
  const dialog = page.getByTestId('settings-dialog');
  if (await dialog.isVisible().catch(() => false)) {
    await page.getByTestId('settings-dialog-close').click();
    await expect(dialog).toHaveCount(0, { timeout: 5_000 });
  }
}

/** Opens the dialog and navigates to a tab. `open()` always resets to the General tab, so every
 *  reopen after a change must re-navigate before re-reading a persisted value. */
async function openTab(page: Page, tab: SettingsTab): Promise<void> {
  await openSettings(page);
  if (tab !== 'general') await page.getByTestId(`settings-nav-${tab}`).click();
  await page.getByTestId(`settings-pane-${tab}`).waitFor({ timeout: 10_000 });
}

/** Opens the dialog, the Providers tab, and a specific provider's sub-item + form. */
async function openProviderPane(page: Page, adapterId: string): Promise<void> {
  await openTab(page, 'providers');
  await page.getByTestId(`settings-nav-provider-${adapterId}`).click();
  await page.getByTestId(`settings-pane-provider-${adapterId}`).waitFor({ timeout: 10_000 });
}

// ─── §26 Settings — chrome, General, Notifications, Providers, About, Remote Access ───────────

test.describe('§settings', () => {
  let app: TauriAppFixture;

  test.beforeAll(async () => {
    app = await launchTauriApp();
  });

  test.afterAll(async () => {
    await closeTauriApp(app);
  });

  // ─── Chrome: open/close, tab nav ──────────────────────────────────────────────

  test('sidebar-settings-button opens the dialog; close button closes it', async () => {
    const { page } = app;
    await openSettings(page);
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await closeSettings(page);
  });

  test('⌘, opens the dialog via the global hotkey', async () => {
    const { page } = app;
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
    await page.keyboard.press('Meta+,');
    await expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: 5_000 });
    await closeSettings(page);
  });

  test('Esc closes the dialog', async () => {
    const { page } = app;
    await openSettings(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0, { timeout: 5_000 });
  });

  test('all five tabs render their pane; there is no keybindings tab', async () => {
    const { page } = app;
    // Open the dialog ONCE, then navigate tabs in place. The previous version
    // called `openTab()` (which itself calls `openSettings()`) on every loop
    // iteration — after the first tab, the dialog is already open and its
    // scrim backdrop (`fixed inset-0 z-50 ...`) covers `sidebar-settings-button`,
    // so the re-click never lands and the test hangs to the 120s timeout. Real
    // usage never re-opens an already-open dialog; every other test in this file
    // calls `openTab`/`openSettings` exactly once per test, which is why this was
    // the only one affected.
    await openSettings(page);
    const tabs: SettingsTab[] = ['general', 'providers', 'notifications', 'remote-access', 'about'];
    for (const tab of tabs) {
      if (tab !== 'general') await page.getByTestId(`settings-nav-${tab}`).click();
      await expect(page.getByTestId(`settings-pane-${tab}`)).toBeVisible({ timeout: 10_000 });
    }
    await expect(page.getByTestId('settings-nav-keybindings')).toHaveCount(0);
    await closeSettings(page);
  });

  // ─── General: appearance (client-persisted) ───────────────────────────────────

  test('appearance controls apply a token change and persist across reload', async () => {
    const { page } = app;
    await openTab(page, 'general');

    await page.getByTestId('settings-appearance-mode-dark').click();
    await page.getByTestId('settings-appearance-scheme-ocean').click();
    await page.getByTestId('settings-appearance-ui-scale-large').click();
    await page.getByTestId('settings-appearance-window-style-split').click();

    // Immediate reactive effect: mode → <html>.dark, scheme → <html data-scheme>.
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('data-scheme', 'ocean');
    await expect(page.getByTestId('settings-appearance-ui-scale-large')).toHaveClass(/bg-accent/);
    await expect(page.getByTestId('settings-appearance-window-style-split')).toHaveClass(/bg-accent/);

    await closeSettings(page);
    // Full reload proves localStorage persistence, not just in-memory zustand state.
    await page.reload();
    await page.getByTestId('sidebar-settings-button').waitFor({ timeout: 20_000 });

    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('data-scheme', 'ocean');

    await openTab(page, 'general');
    await expect(page.getByTestId('settings-appearance-mode-dark')).toHaveClass(/bg-accent/);
    await expect(page.getByTestId('settings-appearance-scheme-ocean')).toHaveClass(/bg-accent/);
    await expect(page.getByTestId('settings-appearance-ui-scale-large')).toHaveClass(/bg-accent/);
    await expect(page.getByTestId('settings-appearance-window-style-split')).toHaveClass(/bg-accent/);
    await closeSettings(page);
  });

  // ─── General: worktree directory (daemon-persisted) ───────────────────────────

  test('worktree-dir Save button appears only when dirty, and the value persists on reopen', async () => {
    const { page } = app;
    await openTab(page, 'general');

    const input = page.getByTestId('settings-worktree-dir-input');
    const save = page.getByTestId('settings-worktree-dir-save');
    await expect(input).toHaveValue('.worktrees');
    await expect(save).toHaveCount(0);

    await input.fill('.mf-e2e-worktrees');
    await expect(save).toBeVisible({ timeout: 3_000 });
    await save.click();
    await expect(save).toHaveCount(0, { timeout: 5_000 });

    await closeSettings(page);
    await openTab(page, 'general');
    await expect(page.getByTestId('settings-worktree-dir-input')).toHaveValue('.mf-e2e-worktrees');
    await closeSettings(page);
  });

  // ─── Notifications: leaf-patch persistence + resync-on-failure ────────────────

  test('a notification toggle flips and persists across reopen', async () => {
    const { page } = app;
    await openTab(page, 'notifications');

    const toggle = page.getByTestId('settings-notify-task-complete-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 5_000 });

    await closeSettings(page);
    await openTab(page, 'notifications');
    await expect(page.getByTestId('settings-notify-task-complete-toggle')).toHaveAttribute('aria-checked', 'false');
    await closeSettings(page);
  });

  test('a failed PATCH reverts the toggle via resync (leaf-patch with resync-on-failure)', async () => {
    const { page } = app;
    // Block only the write (PUT); the resync GET after the failure must still succeed. A short
    // delay before aborting keeps the optimistic-flip window observable (otherwise the abort +
    // resync round-trip can resolve inside a single assertion poll tick, on localhost).
    await page.route('**/api/settings/general', async (route) => {
      if (route.request().method() === 'PUT') {
        await new Promise((r) => setTimeout(r, 400));
        await route.abort();
        return;
      }
      await route.continue();
    });

    await openTab(page, 'notifications');
    const toggle = page.getByTestId('settings-notify-session-error-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.click();
    // Optimistic flip happens immediately...
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    // ...then the failed PUT triggers a GET resync that restores the server's true value.
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });

    await page.unroute('**/api/settings/general');
    await closeSettings(page);
  });

  // ─── Providers: exec path, session mode, model, toggles (all daemon-persisted) ─

  test('Providers nav lists the claude adapter and opens its config form', async () => {
    const { page } = app;
    await openTab(page, 'providers');
    await expect(page.getByTestId('settings-nav-provider-claude')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('settings-nav-provider-claude').click();
    await expect(page.getByTestId('settings-provider-header-claude')).toBeVisible();
    await expect(page.getByTestId('settings-pane-provider-claude')).toBeVisible();
    await closeSettings(page);
  });

  test('executable path commits on blur and persists on reopen', async () => {
    const { page } = app;
    await openProviderPane(page, 'claude');

    const input = page.getByTestId('settings-claude-executable-path-input');
    await input.fill('/usr/local/bin/claude-e2e');
    await page.keyboard.press('Tab');

    await closeSettings(page);
    await openProviderPane(page, 'claude');
    await expect(page.getByTestId('settings-claude-executable-path-input')).toHaveValue('/usr/local/bin/claude-e2e');
    await closeSettings(page);
  });

  test('default session mode radio persists on reopen', async () => {
    const { page } = app;
    await openProviderPane(page, 'claude');

    const yolo = page.getByTestId('settings-claude-mode-option-yolo');
    await yolo.click();
    await expect(yolo).toHaveAttribute('aria-checked', 'true');

    await closeSettings(page);
    await openProviderPane(page, 'claude');
    await expect(page.getByTestId('settings-claude-mode-option-yolo')).toHaveAttribute('aria-checked', 'true');
    await closeSettings(page);
  });

  test('default model dropdown pick persists on reopen', async () => {
    const { page } = app;
    await openProviderPane(page, 'claude');

    await page.getByTestId('settings-claude-model-dropdown-trigger').click();
    // The daemon probes the REAL `claude` CLI on PATH at startup
    // (packages/core/.../claude/probe-models.ts) and, when it responds within
    // the probe timeout, REPLACES the static CLAUDE_MODELS fallback with the
    // live-installed catalog — confirmed live in this environment (Claude Code
    // 2.1.198 returns default/opus[1m]/claude-fable-5[1m]/sonnet/haiku, not the
    // hardcoded claude-opus-4-6/claude-sonnet-4-6/… ids the plan assumed). The
    // label text differs between sources too ("Opus 4.6 (1M context)" statically
    // vs whatever the installed CLI reports), but `id: 'opus[1m]'` is present in
    // BOTH catalogs (packages/core/src/plugins/builtin/claude/adapter.ts
    // CLAUDE_MODELS), so pick it by id and assert whatever label actually
    // renders persists, rather than hardcoding a label tied to one source.
    const option = page.getByTestId('settings-claude-model-option-opus[1m]');
    await expect(option).toBeVisible({ timeout: 5_000 });
    const label = (await option.textContent())?.trim();
    expect(label).toBeTruthy();
    await option.click();

    const trigger = page.getByTestId('settings-claude-model-dropdown-trigger');
    await expect(trigger).toContainText(label!);

    await closeSettings(page);
    await openProviderPane(page, 'claude');
    await expect(trigger).toContainText(label!, { timeout: 5_000 });
    await closeSettings(page);
  });

  test('system-prompt and plan-mode toggles persist on reopen', async () => {
    const { page } = app;
    await openProviderPane(page, 'claude');

    const systemPrompt = page.getByTestId('settings-claude-system-prompt-toggle');
    const planMode = page.getByTestId('settings-claude-plan-mode-toggle');
    await expect(systemPrompt).toHaveAttribute('aria-checked', 'false');
    await expect(planMode).toHaveAttribute('aria-checked', 'false');
    await systemPrompt.click();
    await planMode.click();
    await expect(systemPrompt).toHaveAttribute('aria-checked', 'true');
    await expect(planMode).toHaveAttribute('aria-checked', 'true');

    await closeSettings(page);
    await openProviderPane(page, 'claude');
    await expect(page.getByTestId('settings-claude-system-prompt-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('settings-claude-plan-mode-toggle')).toHaveAttribute('aria-checked', 'true');
    await closeSettings(page);
  });

  // ─── About ──────────────────────────────────────────────────────────────────

  test('About pane populates version and author from the host bridge', async () => {
    const { page } = app;
    await openTab(page, 'about');
    // Browser mode resolves FakeHostBridge (lib/host/index.ts createHost), whose default
    // app.getInfo() stub is { version: 'dev', author: 'mainframe', homedir: '' }. NOTE:
    // TruncatedWithTooltip (components/ui/truncated-with-tooltip.tsx) `if (!text) return null`,
    // so the homedir row's `settings-about-homedir` span does not render at all for an empty
    // string — not asserted here (see report).
    await expect(page.getByTestId('settings-about-version')).toHaveText('dev', { timeout: 10_000 });
    await expect(page.getByTestId('settings-about-author')).toHaveText('mainframe');
    await closeSettings(page);
  });

  test('About pane renders no check-for-updates button', async () => {
    const { page } = app;
    await openTab(page, 'about');
    await expect(page.getByTestId('settings-about-check-updates')).toHaveCount(0);
    await closeSettings(page);
  });

  // ─── Remote Access: section containers + form validation only (no live tunnel) ─

  test('Remote Access renders the named-tunnel, quick-tunnel, and devices sections', async () => {
    const { page } = app;
    await openTab(page, 'remote-access');
    // No named-tunnel config exists in a fresh e2e daemon, so TunnelControl renders the
    // quick-tunnel section too (NamedTunnelSection + QuickTunnelSection are mutually
    // exclusive only once a named config is saved — see TunnelControl.tsx).
    await expect(page.getByTestId('settings-remote-access-named-tunnel-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('settings-remote-access-quick-tunnel-section')).toBeVisible();
    await expect(page.getByTestId('settings-remote-access-devices-section')).toBeVisible();
    await expect(page.getByTestId('settings-remote-access-devices-section')).toContainText('No paired devices.');
    // Pairing only renders once a tunnel is verified-reachable — not reached here.
    await expect(page.getByTestId('settings-remote-access-pairing-section')).toHaveCount(0);
    await closeSettings(page);
  });

  test('named-tunnel Save is disabled until both token and URL are filled', async () => {
    const { page } = app;
    await openTab(page, 'remote-access');

    const save = page.getByTestId('named-tunnel-save');
    await expect(save).toBeDisabled();

    await page.getByTestId('named-tunnel-token-input').fill('cf-connector-token-e2e');
    await expect(save).toBeDisabled();

    await page.getByTestId('named-tunnel-url-input').fill('https://mainframe-e2e.example.com');
    await expect(save).toBeEnabled();

    // TODO(app-tauri): do not click Save — it calls tunnel.start(), which spawns a real
    // cloudflared process and reaches the network. Live tunnel start/stop is out of scope
    // per the shared brief ("external network"); this test only proves the field validation gate.
    await closeSettings(page);
  });

  test('quick-tunnel toggle is present and enabled (start left untriggered)', async () => {
    const { page } = app;
    await openTab(page, 'remote-access');
    const toggle = page.getByTestId('quick-tunnel-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveText('Start');
    // TODO(app-tauri): do not click — Start calls tunnel.start(), a real trycloudflare.com
    // tunnel (external network). Pre-toggle UI only, per the shared brief.
    await closeSettings(page);
  });
});

// ─── §26 Settings — tuning inheritance (legacy IT4/IT5) ────────────────────────────────────────

test.describe('§settings tuning inheritance', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a new chat inherits a provider default effort; a per-chat override does not mutate the provider default', async () => {
    const { page } = app;

    // Requires the mock-cli adapter (only registered under E2E_MODE=mock) with its
    // capability-declaring opus-tier model — mirrors composer.spec.ts's skip-gracefully pattern.
    await openTab(page, 'providers');
    const providerItem = page.getByTestId('settings-nav-provider-mock-cli');
    if (!(await providerItem.isVisible({ timeout: 5_000 }).catch(() => false))) {
      await closeSettings(page);
      test.skip(true, 'mock-cli adapter not registered in this environment (needs E2E_MODE=mock)');
      return;
    }
    await providerItem.click();
    await page.getByTestId('settings-pane-provider-mock-cli').waitFor({ timeout: 10_000 });

    // Switch the provider default model to the opus-tier one (declares xhigh+max efforts).
    await page.getByTestId('settings-mock-cli-model-dropdown-trigger').click();
    await page.getByTestId('settings-mock-cli-model-option-claude-opus-4-5-20251001').click();

    // Set the provider default effort to 'high'.
    const providerEffort = page.getByTestId('settings-mock-cli-default-effort');
    await expect(providerEffort).toBeVisible({ timeout: 5_000 });
    await providerEffort.click();
    await page.getByTestId('settings-mock-cli-default-effort-option-high').click();
    await expect(providerEffort).toContainText(/high/i);

    await closeSettings(page);

    // Create a brand-new chat on the same adapter (only session-creation call in this
    // describe — no prior sendMessage/reload, so the useSessionListRouter navigation race
    // documented in chat.spec.ts's mid-test createTauriChat note does not apply here).
    await createTauriChat(page, project.projectId, 'default', 'mock-cli');

    // Switch the composer to the opus-tier model — the effort chip must reflect the
    // EFFECTIVE value (chat override → provider default → model default). A fresh chat has
    // no override, so it inherits the provider default set above.
    await page.getByTestId('composer-model-select').click();
    await page.getByTestId('composer-model-select-option-claude-opus-4-5-20251001').click();
    const composerEffort = page.getByTestId('composer-effort-select');
    await expect(composerEffort).toBeVisible({ timeout: 5_000 });
    await expect(composerEffort).toContainText(/high/i);

    // Explicitly override the per-chat effort to 'low'.
    await composerEffort.click();
    await page.getByTestId('composer-effort-select-option-low').click();
    await expect(composerEffort).toContainText(/low/i);

    // The provider default in Settings must be unaffected by the chat-level override.
    await openTab(page, 'providers');
    await page.getByTestId('settings-nav-provider-mock-cli').click();
    await expect(page.getByTestId('settings-mock-cli-default-effort')).toContainText(/high/i, { timeout: 5_000 });
    await closeSettings(page);
  });
});
