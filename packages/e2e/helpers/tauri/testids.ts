/** Desktop→app-tauri 1:1 testid renames. Workflow/dynamic differences live in page-objects.ts.
 *  All values verified against packages/app-tauri/src. */
export const T = {
  statusBar: 'app-status-bar',
  connectionDot: 'app-connection-dot',
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
  effortSelect: 'composer-effort-select',
  permissionModeSelect: 'composer-permission-mode-select',
  featuresTrigger: 'composer-features-trigger',
  adapterSelect: 'composer-adapter-select',
  sessionsNewButton: 'sessions-new-button',
  sessionsMoreButton: 'sessions-more-button',
} as const;
