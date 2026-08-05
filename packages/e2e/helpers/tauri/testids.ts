/** Desktop→app-tauri 1:1 testid renames. Workflow/dynamic differences live in page-objects.ts.
 *  All values verified against packages/ui/src. */
export const T = {
  // `app-status-bar` was retired (~2026-06-23, App.integration.test.tsx asserts it's absent);
  // connection status now lives in the sidebar footer — see `waitConnected()` in wait.ts.
  daemonFooterTrigger: 'daemon-footer-trigger',
  sessionRow: 'sessions-row',
  composerInput: 'chat-composer-input',
  composerSend: 'chat-composer-send',
  planToggle: 'composer-plan-toggle',
  thread: 'chat-thread',
  userMessage: 'chat-user-message',
  assistantMessage: 'chat-assistant-message',
  permissionGate: 'chat-permission-gate',
  planGate: 'chat-plan-gate',
  questionGate: 'chat-question-gate',
  modelSelect: 'composer-model-select',
  permissionModeSelect: 'composer-permission-mode-select',
  adapterSelect: 'composer-adapter-select',
  sessionsNewButton: 'sessions-new-button',
  sessionsMoreButton: 'sessions-more-button',
} as const;

/**
 * Toast selectors. Toasts are NATIVE sonner since the 2026-08-05 port: `mfToast`
 * raises through sonner's own renderer, so `WsToastCard` and its testids
 * (`toast-root`, `toast-status-chip`, `toast-countdown-rail`, `toast-dismiss`) are
 * gone — there is no status chip and no countdown rail to assert. What survives is
 * sonner's data-attribute contract plus `mfToast`'s own type→policy table
 * (`lib/toast.ts`): error/permission persist and get a close button; everything
 * else auto-dismisses after ~4.2s with no close button.
 */
export const TOAST = {
  /** One toast. `data-type` carries success|error|warning|info. */
  root: '[data-sonner-toast]',
  title: '[data-title]',
  description: '[data-description]',
  /** Only rendered for the persistent types. */
  close: '[data-close-button]',
  /** The action row ("Open session", "Details"). */
  action: '[data-button]',
} as const;

/**
 * Workspace-surface selectors (the merged Files+Run surface, 2026-08-05).
 *
 * The strip root and the pane root are keyed by pane id — `workspace-tab-strip-<paneId>`
 * and `workspace-pane-<paneId>` — and a pane id is always `pane-<hex>` (`genId('pane')`
 * in `store/run-pane.ts`). The tighter `-pane-` prefix is therefore what separates a
 * root from the buttons and menu rows that share the shorter prefix
 * (`workspace-tab-strip-add-<paneId>`, `workspace-pane-close-<paneId>`,
 * `workspace-pane-launch-<config>-<paneId>`, …). Verified live before the merge with
 * the identical `run-pane-pane-` trick: a 2-pane split matched 3 elements on the loose
 * prefix.
 */
export const WORKSPACE = {
  /** One pane's tab-strip row. */
  strip: '[data-testid^="workspace-tab-strip-pane-"]',
  /** One pane's root (strip + bodies). */
  pane: '[data-testid^="workspace-pane-pane-"]',
  /** Every tab pill in the surface. `[role=tab]` excludes the per-tab close/stop buttons. */
  tab: '[data-testid^="workspace-tab-"][role="tab"]',
  /** A pane's `+` trigger. */
  add: '[data-testid^="workspace-tab-strip-add-"]',
} as const;
