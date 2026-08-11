# e2e — test-ids not referenced by any test

_Generated 2026-08-11. Source: packages/ui/src data-testids (956) minus e2e references
(544). Unused: 412._

> "Unused" means the test-id string isn't referenced in a Playwright locator or passed as a bare
> string to a helper. Some of these elements ARE exercised via role/text locators (e.g. permission
> buttons via getByRole), so this lists selector gaps, not necessarily untested behavior. `${…}`
> marks templated id families.

## automations (79)

- `automations-blank-build`
- `automations-blank-describe`
- `automations-blank-state`
- `automations-condition-${…}`
- `automations-condition-remove-${…}`
- `automations-describe`
- `automations-describe-back`
- `automations-describe-draft`
- `automations-describe-input`
- `automations-describe-open-editor`
- `automations-describe-retry`
- `automations-details`
- `automations-details-back`
- `automations-details-edit`
- `automations-details-not-found`
- `automations-details-overview`
- `automations-details-run`
- `automations-details-run-${…}`
- `automations-details-runs`
- `automations-details-runs-empty`
- `automations-details-step-${…}`
- `automations-details-tab-${…}`
- `automations-draft-preview`
- `automations-editor`
- `automations-editor-back`
- `automations-editor-cancel`
- `automations-editor-description`
- `automations-editor-issues`
- `automations-editor-name`
- `automations-editor-save`
- `automations-file-item`
- `automations-if-add-condition-${…}`
- `automations-if-add-otherwise-${…}`
- `automations-if-match-all`
- `automations-if-match-any`
- `automations-if-remove-otherwise-${…}`
- `automations-library`
- `automations-library-edit-${…}`
- `automations-library-error`
- `automations-library-error-banner`
- `automations-library-error-retry`
- `automations-library-last-run-${…}`
- `automations-library-loading`
- `automations-library-new`
- `automations-library-retry`
- `automations-library-row-${…}`
- `automations-library-run-${…}`
- `automations-library-toggle-${…}`
- `automations-recipe-${…}`
- `automations-recipe-root`
- `automations-repeat-items-${…}`
- `automations-repeat-items-picker-${…}`
- `automations-run-again`
- `automations-run-back`
- `automations-run-cancel`
- `automations-run-not-found`
- `automations-run-repeat-${…}`
- `automations-run-step-${…}`
- `automations-run-timeline`
- `automations-run-view`
- `automations-section-describe`
- `automations-section-details`
- `automations-section-editor`
- `automations-section-library`
- `automations-section-run`
- `automations-skill-item`
- `automations-step-${…}`
- `automations-step-config-${…}`
- `automations-step-delete-${…}`
- `automations-step-grip-${…}`
- `automations-step-issues-${…}`
- `automations-step-setup-${…}`
- `automations-step-title-${…}`
- `automations-title-count`
- `automations-trigger-${…}`
- `automations-view`
- `automations-when-add`
- `automations-when-add-${…}`
- `automations-when-add-menu`

## chat (53)

- `chat-ask-answer-notes`
- `chat-ask-answer-preview`
- `chat-ask-question-text`
- `chat-ask-trigger`
- `chat-capture-selector`
- `chat-compacting-pill`
- `chat-composer-cancel`
- `chat-composer-edit-cancel`
- `chat-composer-edit-save`
- `chat-composer-edit-toolbar`
- `chat-composer-toolbar`
- `chat-degraded-continue`
- `chat-degraded-error`
- `chat-edit-error-text`
- `chat-edit-trigger`
- `chat-error-block`
- `chat-header-grip`
- `chat-image-zoom-dialog`
- `chat-image-zoom-image`
- `chat-image-zoom-trigger`
- `chat-link-copy`
- `chat-link-copy-url`
- `chat-link-open`
- `chat-message-session-chip-${…}`
- `chat-plan-exec-mode`
- `chat-plan-revise-cancel`
- `chat-question-text`
- `chat-queued-bubble`
- `chat-reasoning-toggle`
- `chat-slash-command-args`
- `chat-system-message`
- `chat-thread-area`
- `chat-thread-load-error`
- `chat-thread-load-retry`
- `chat-thread-running-elapsed`
- `chat-thread-running-text`
- `chat-tool-fallback-error`
- `chat-user-attachment-${…}`
- `chat-user-attachments`
- `chat-user-message-retry`
- `chat-user-message-send-error`
- `chat-user-message-send-failed`
- `chat-user-snippet-expand-${…}`
- `chat-user-snippet-scroll-${…}`
- `chat-workflow-agent-${…}`
- `chat-workflow-back-${…}`
- `chat-workflow-launcher-${…}`
- `chat-workflow-launcher-dot`
- `chat-workflow-panel-${…}`
- `chat-workflow-phase-${…}`
- `chat-workflow-phase-unassigned`
- `chat-workflow-stale-banner-${…}`
- `chat-write-error-text`

## tasks (32)

- `tasks-board-loading`
- `tasks-edit-body`
- `tasks-github-banner`
- `tasks-github-banner-dismiss`
- `tasks-github-banner-report`
- `tasks-github-credential`
- `tasks-github-import-all`
- `tasks-github-import-cancel`
- `tasks-github-import-confirm`
- `tasks-github-import-dialog`
- `tasks-github-import-error`
- `tasks-github-import-issue-${…}`
- `tasks-github-link`
- `tasks-github-link-cancel`
- `tasks-github-link-confirm`
- `tasks-github-link-dialog`
- `tasks-github-menu-import`
- `tasks-github-menu-report`
- `tasks-github-menu-sync`
- `tasks-github-menu-unlink`
- `tasks-github-pill`
- `tasks-github-publish-cancel`
- `tasks-github-publish-confirm`
- `tasks-github-publish-dialog`
- `tasks-github-publish-labels`
- `tasks-github-remote-${…}`
- `tasks-github-report-copy-${…}`
- `tasks-github-report-dialog`
- `tasks-github-report-row-${…}`
- `tasks-github-unlink-dialog`
- `tasks-priority-dot-${…}`
- `tasks-quick-feature`

## skills (24)

- `skills-browse-catalog-empty`
- `skills-browse-catalog-unavailable`
- `skills-browse-loading`
- `skills-browse-manifest-error`
- `skills-browse-no-results`
- `skills-browse-search`
- `skills-browse-search-error`
- `skills-browse-skeleton`
- `skills-row-${…}`
- `skills-row-action-${…}`
- `skills-row-scope-${…}`
- `skills-section-adapter-note`
- `skills-section-cli-unavailable`
- `skills-section-failure-tail`
- `skills-section-failure-tail-toggle`
- `skills-section-install`
- `skills-section-install-scope`
- `skills-section-install-scope-${…}`
- `skills-section-skill-name-input`
- `skills-section-skill-option-${…}`
- `skills-section-skill-picker-empty`
- `skills-section-skill-picker-spinner`
- `skills-section-source`
- `skills-section-source-error`

## sessions (21)

- `sessions-archive-cancel`
- `sessions-draft-row-title`
- `sessions-import-back`
- `sessions-meta-card`
- `sessions-meta-card-label-${…}`
- `sessions-meta-card-pr`
- `sessions-meta-card-tags`
- `sessions-meta-card-title`
- `sessions-meta-card-worktree`
- `sessions-more-menu`
- `sessions-row-meta`
- `sessions-row-meta-glyphs`
- `sessions-row-meta-pr`
- `sessions-row-meta-tag-dots`
- `sessions-row-pin-glyph`
- `sessions-row-project`
- `sessions-row-provider-logo`
- `sessions-section`
- `sessions-tag-filter-synthetic-${…}`
- `sessions-tag-popover-error`
- `sessions-welcome-suggestion-insert-${…}`

## settings (16)

- `settings-about-homedir`
- `settings-config-conflicts-warning`
- `settings-default-provider-option-${…}`
- `settings-default-provider-option-auto`
- `settings-default-provider-select`
- `settings-notify-attention-request-toggle`
- `settings-notify-plan-approval-toggle`
- `settings-notify-plugin-toggle`
- `settings-notify-tool-request-toggle`
- `settings-notify-user-question-toggle`
- `settings-pane-about`
- `settings-pane-general`
- `settings-pane-notifications`
- `settings-pane-providers`
- `settings-pane-remote-access`
- `settings-remote-access-port-tunnels-section`

## composer (14)

- `composer-adapter-locked-${…}`
- `composer-adapter-logo-${…}`
- `composer-attachments`
- `composer-dropzone`
- `composer-file-item`
- `composer-model-group-header-${…}`
- `composer-model-older-header`
- `composer-segment`
- `composer-segment-input`
- `composer-skill-item`
- `composer-tuning-warning`
- `composer-worktree-busy`
- `composer-worktree-draft-cancel`
- `composer-worktree-draft-panel`

## preview (13)

- `preview-annotation-backdrop`
- `preview-annotation-cancel`
- `preview-annotation-input-${…}`
- `preview-annotation-item-${…}`
- `preview-annotation-list`
- `preview-annotation-popover`
- `preview-annotation-submit`
- `preview-body-tunnel-failed`
- `preview-device-toggle`
- `preview-instance-${…}`
- `preview-toolbar-capture`
- `preview-toolbar-region`
- `preview-tunnel-pending`

## url (11)

- `url-tab-annotation-backdrop`
- `url-tab-body-failed`
- `url-tab-body-invalid`
- `url-tab-body-loaded`
- `url-tab-body-pending`
- `url-tab-body-rejected`
- `url-tab-body-stopped`
- `url-tab-inspect-active-indicator`
- `url-tab-instance-${…}`
- `url-tab-retry`
- `url-tab-toolbar`

## daemon (10)

- `daemon-add-error`
- `daemon-add-insecure`
- `daemon-add-reachable`
- `daemon-add-retry`
- `daemon-add-storage-error`
- `daemon-add-unreachable`
- `daemon-dialog-cancel`
- `daemon-footer-trigger-host`
- `daemon-pair-insecure`
- `daemon-picker-fallback`

## provider (9)

- `provider-quota-card`
- `provider-quota-freshness-${…}`
- `provider-quota-glyph-${…}`
- `provider-quota-popover-${…}`
- `provider-quota-popover-glyph-${…}`
- `provider-quota-refresh-${…}`
- `provider-quota-row-${…}`
- `provider-quota-unknown-${…}`
- `provider-quota-window-${…}`

## sidebar (8)

- `sidebar-collapse`
- `sidebar-project-badge-all`
- `sidebar-project-more`
- `sidebar-project-unavailable-${…}`
- `sidebar-projects-toggle`
- `sidebar-scroll`
- `sidebar-update-pill`
- `sidebar-workflows-pending`

## automation (7)

- `automation-recommender-copy-${…}`
- `automation-recommender-evidence-toggle`
- `automation-recommender-loading`
- `automation-recommender-open`
- `automation-recommender-retry`
- `automation-recommender-sheet`
- `automation-recommender-tab-${…}`

## editor (7)

- `editor-comment-widget-send`
- `editor-context-menu`
- `editor-references-panel`
- `editor-references-panel-close`
- `editor-references-row-${…}`
- `editor-tab`
- `editor-tab-readonly`

## run (7)

- `run-console-clear`
- `run-console-drawer`
- `run-console-drawer-toggle`
- `run-console-log-area`
- `run-console-log-lines`
- `run-console-resize`
- `run-terminal-${…}`

## search (7)

- `search-card-error-body`
- `search-card-path`
- `search-card-plain-body`
- `search-card-trigger`
- `search-palette-footer`
- `search-palette-loading`
- `search-palette-symbol-row-${…}`

## session (7)

- `session-panel-launch-spinner-${…}`
- `session-panel-summary-empty`
- `session-panel-task-${…}`
- `session-panel-workflow-${…}`
- `session-panel-workflow-back-${…}`
- `session-panel-working-dot`
- `session-tabs`

## image (6)

- `image-context-menu`
- `image-copy`
- `image-lightbox-counter`
- `image-lightbox-current`
- `image-lightbox-next`
- `image-lightbox-prev`

## smart (6)

- `smart-action-instruction-append`
- `smart-action-instruction-new-session`
- `smart-action-url-open`
- `smart-action-url-open-browser`
- `smart-action-url-open-in-app`
- `smart-action-url-stop-tunnel`

## workspace (6)

- `workspace-pane-open-url-${…}`
- `workspace-picker-recent-${…}`
- `workspace-surface-drag`
- `workspace-tab-stop-${…}`
- `workspace-url-entry`
- `workspace-url-entry-input`

## git (5)

- `git-branch-group-${…}`
- `git-new-branch-cancel`
- `git-new-branch-start-option-${…}`
- `git-rename-cancel`
- `git-submenu-rebase`

## main (5)

- `main-surface-shell`
- `main-toolbar`
- `main-toolbar-branch-wt`
- `main-toolbar-search-hint`
- `main-toolbar-theme`

## push (5)

- `push-notification-card-error-body`
- `push-notification-card-message`
- `push-notification-card-result`
- `push-notification-card-root`
- `push-notification-card-trigger`

## viewer (5)

- `viewer-unsupported`
- `viewer-unsupported-card`
- `viewer-unsupported-icon-chip`
- `viewer-unsupported-open`
- `viewer-unsupported-reveal`

## worktree (5)

- `worktree-switch-accept`
- `worktree-switch-banner`
- `worktree-switch-dismiss`
- `worktree-switch-row`
- `worktree-switch-status`

## error (4)

- `error-state-copy`
- `error-state-reload`
- `error-state-retry`
- `error-state-root`

## toast (4)

- `toast-details-body`
- `toast-details-close`
- `toast-details-copy`
- `toast-details-dialog`

## pairing (3)

- `pairing-code-copy`
- `pairing-generate-code`
- `pairing-regenerate-code`

## review (3)

- `review-commit-error`
- `review-file-status-${…}`
- `review-load-error`

## thread (3)

- `thread-find-close`
- `thread-find-next`
- `thread-find-prev`

## tunnel (3)

- `tunnel-recheck-verify`
- `tunnel-url-copy-ready`
- `tunnel-url-copy-unreachable`

## app (2)

- `app-shell-root`
- `app-waiting-daemon`

## directory (2)

- `directory-picker-load-error-${…}`
- `directory-picker-node-loading-${…}`

## edit (2)

- `edit-card-diff-raw`
- `edit-card-diff-unavailable`

## external (2)

- `external-session-branch`
- `external-session-worktree`

## named (2)

- `named-tunnel-clear-config`
- `named-tunnel-toggle`

## remote (2)

- `remote-access-device-remove-${…}`
- `remote-access-port-tunnel-stop-${…}`

## tool (2)

- `tool-card-status-dot`
- `tool-result-expand-collapse`

## confirm (1)

- `confirm-dialog`

## file (1)

- `file-picker-loading`

## find (1)

- `find-in-path-error`

## gate (1)

- `gate-head-tile`

## new (1)

- `new-session-initialization-retry`

## read (1)

- `read-card-error-body`

## setup (1)

- `setup-advisor-section-${…}`

## surface (1)

- `surface-rail`

## trigger (1)

- `trigger-field-popover`

## web (1)

- `web-fetch-card-error-body`
