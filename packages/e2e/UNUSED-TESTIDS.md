# e2e — test-ids not referenced by any test

_Generated 2026-08-11. Source: packages/ui/src data-testids (892) minus e2e references
(366). Unused: 526._

> "Unused" means the test-id string isn't referenced in a Playwright locator or passed as a bare
> string to a helper. Some of these elements ARE exercised via role/text locators (e.g. permission
> buttons via getByRole), so this lists selector gaps, not necessarily untested behavior. `${…}`
> marks templated id families.

## chat (82)

- `chat-ask-answer-notes`
- `chat-ask-answer-preview`
- `chat-ask-card`
- `chat-ask-header`
- `chat-ask-question-text`
- `chat-ask-trigger`
- `chat-capture-selector`
- `chat-compacting-pill`
- `chat-compaction-pill`
- `chat-composer-cancel`
- `chat-composer-edit-cancel`
- `chat-composer-edit-save`
- `chat-composer-edit-toolbar`
- `chat-composer-toolbar`
- `chat-degraded-card`
- `chat-degraded-continue`
- `chat-degraded-delete`
- `chat-degraded-error`
- `chat-degraded-project-root`
- `chat-degraded-recreate-worktree`
- `chat-edit-error-text`
- `chat-error-block`
- `chat-header-grip`
- `chat-header-hide`
- `chat-header-model`
- `chat-header-split-down`
- `chat-header-split-right`
- `chat-image-zoom-dialog`
- `chat-image-zoom-trigger`
- `chat-link-copy`
- `chat-link-copy-url`
- `chat-link-open`
- `chat-mcp-pill`
- `chat-message-menu-trigger`
- `chat-message-session-chip-${…}`
- `chat-plan-exec-mode`
- `chat-plan-label`
- `chat-plan-revise-cancel`
- `chat-plan-trigger`
- `chat-question-text`
- `chat-queued-bubble`
- `chat-reasoning-toggle`
- `chat-schedule-${…}`
- `chat-scroll-to-bottom`
- `chat-selection-new-session`
- `chat-selection-toolbar`
- `chat-slash-command-args`
- `chat-system-message`
- `chat-task-progress-card`
- `chat-task-progress-item-${…}`
- `chat-task-progress-toggle`
- `chat-thread-area`
- `chat-thread-load-error`
- `chat-thread-load-retry`
- `chat-thread-running-elapsed`
- `chat-thread-running-text`
- `chat-tool-fallback-args`
- `chat-tool-fallback-card`
- `chat-tool-fallback-error`
- `chat-tool-fallback-result`
- `chat-tool-fallback-trigger`
- `chat-tool-group`
- `chat-tool-group-toggle`
- `chat-user-attachment-${…}`
- `chat-user-attachments`
- `chat-user-message-retry`
- `chat-user-message-send-error`
- `chat-user-message-send-failed`
- `chat-user-readmore-toggle`
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
- `chat-worktree-${…}`
- `chat-write-card`
- `chat-write-error-text`

## automations (74)

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
- `automations-run-timeline`
- `automations-run-view`
- `automations-section-describe`
- `automations-section-details`
- `automations-section-editor`
- `automations-section-library`
- `automations-section-run`
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

## tasks (71)

- `tasks-board-loading`
- `tasks-board-new`
- `tasks-dep-input`
- `tasks-dep-opt-${…}`
- `tasks-dep-pill-${…}`
- `tasks-dep-remove-${…}`
- `tasks-edit-assignees`
- `tasks-edit-body`
- `tasks-edit-cancel`
- `tasks-edit-delete`
- `tasks-edit-milestone`
- `tasks-edit-priority`
- `tasks-edit-save`
- `tasks-edit-status`
- `tasks-edit-title`
- `tasks-edit-type`
- `tasks-filter-search`
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
- `tasks-label-input`
- `tasks-label-pill-${…}`
- `tasks-label-remove-${…}`
- `tasks-list-empty`
- `tasks-list-group-${…}`
- `tasks-list-row-cycle-${…}`
- `tasks-list-row-delete-${…}`
- `tasks-list-row-edit-${…}`
- `tasks-list-row-edit-cta-${…}`
- `tasks-list-row-expand-${…}`
- `tasks-list-row-start-${…}`
- `tasks-list-row-start-cta-${…}`
- `tasks-list-row-type-${…}`
- `tasks-priority-dot-${…}`
- `tasks-quick-body`
- `tasks-quick-bug`
- `tasks-quick-create`
- `tasks-quick-dialog`
- `tasks-quick-feature`
- `tasks-quick-priority-${…}`
- `tasks-quick-title`
- `tasks-sidebar-empty`
- `tasks-sidebar-new`
- `tasks-sidebar-section`
- `tasks-sort-menu`
- `tasks-sort-option-${…}`
- `tasks-view-list`

## sessions (31)

- `sessions-archive-cancel`
- `sessions-archived-dialog`
- `sessions-ctx-archive`
- `sessions-ctx-copy-id`
- `sessions-ctx-pin`
- `sessions-draft-row-title`
- `sessions-import-back`
- `sessions-meta-card`
- `sessions-meta-card-label-${…}`
- `sessions-meta-card-pr`
- `sessions-meta-card-tags`
- `sessions-meta-card-title`
- `sessions-meta-card-warning`
- `sessions-meta-card-worktree`
- `sessions-more-button`
- `sessions-more-menu`
- `sessions-row-meta`
- `sessions-row-meta-glyphs`
- `sessions-row-meta-pr`
- `sessions-row-meta-tag-dots`
- `sessions-row-meta-worktree`
- `sessions-row-project`
- `sessions-section`
- `sessions-tag-delete-confirm`
- `sessions-tag-delete-confirm-cancel`
- `sessions-tag-delete-confirm-ok`
- `sessions-tag-filter-synthetic-${…}`
- `sessions-tag-registry-delete`
- `sessions-tag-registry-rename`
- `sessions-tag-rename-input`
- `sessions-welcome-suggestion-insert-${…}`

## skills (23)

- `skills-browse-catalog-empty`
- `skills-browse-catalog-unavailable`
- `skills-browse-loading`
- `skills-browse-manifest-error`
- `skills-browse-no-results`
- `skills-browse-search`
- `skills-browse-search-error`
- `skills-browse-skeleton`
- `skills-row-${…}`
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

## settings (20)

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
- `settings-provider-header-${…}`
- `settings-remote-access-devices-section`
- `settings-remote-access-named-tunnel-section`
- `settings-remote-access-pairing-section`
- `settings-remote-access-port-tunnels-section`
- `settings-remote-access-quick-tunnel-section`

## preview (16)

- `preview-annotation-backdrop`
- `preview-annotation-cancel`
- `preview-annotation-input-${…}`
- `preview-annotation-item-${…}`
- `preview-annotation-list`
- `preview-annotation-popover`
- `preview-annotation-submit`
- `preview-body-tunnel-failed`
- `preview-device-desktop`
- `preview-device-mobile`
- `preview-device-toggle`
- `preview-instance-${…}`
- `preview-toolbar-capture`
- `preview-toolbar-inspect`
- `preview-toolbar-region`
- `preview-tunnel-pending`

## review (15)

- `review-close`
- `review-comment-input`
- `review-comment-selected-line`
- `review-comment-submit`
- `review-commit-cancel`
- `review-commit-done`
- `review-commit-error`
- `review-commit-input`
- `review-commit-submit`
- `review-commit-suggestion-${…}`
- `review-commit-unviewed-warning`
- `review-file-status-${…}`
- `review-load-error`
- `review-viewed-counter`
- `review-viewed-toggle`

## viewer (12)

- `viewer-csv-empty`
- `viewer-csv-filter`
- `viewer-csv-header-${…}`
- `viewer-image`
- `viewer-image-zoom-in`
- `viewer-image-zoom-out`
- `viewer-svg-source`
- `viewer-unsupported`
- `viewer-unsupported-card`
- `viewer-unsupported-icon-chip`
- `viewer-unsupported-open`
- `viewer-unsupported-reveal`

## daemon (11)

- `daemon-add-error`
- `daemon-add-insecure`
- `daemon-add-reachable`
- `daemon-add-retry`
- `daemon-add-storage-error`
- `daemon-add-unreachable`
- `daemon-dialog-cancel`
- `daemon-dialog-input`
- `daemon-footer-trigger-host`
- `daemon-pair-insecure`
- `daemon-picker-fallback`

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

## composer (10)

- `composer-adapter-logo-${…}`
- `composer-attachments`
- `composer-dropzone`
- `composer-model-group-header-${…}`
- `composer-model-older-header`
- `composer-segment`
- `composer-segment-input`
- `composer-worktree-busy`
- `composer-worktree-draft-cancel`
- `composer-worktree-draft-panel`

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

## session (9)

- `session-panel-launch-spinner-${…}`
- `session-panel-rail-context`
- `session-panel-summary-empty`
- `session-panel-task-${…}`
- `session-panel-workflow-${…}`
- `session-panel-workflow-back-${…}`
- `session-panel-working-dot`
- `session-tabs`
- `session-tabs-new`

## tool (8)

- `tool-card-file-path`
- `tool-card-path-copy-absolute`
- `tool-card-path-copy-relative`
- `tool-card-status-dot`
- `tool-group-trigger-count`
- `tool-group-trigger-label`
- `tool-result-expand-collapse`
- `tool-result-expand-toggle`

## automation (7)

- `automation-recommender-copy-${…}`
- `automation-recommender-evidence-toggle`
- `automation-recommender-loading`
- `automation-recommender-open`
- `automation-recommender-retry`
- `automation-recommender-sheet`
- `automation-recommender-tab-${…}`

## image (7)

- `image-context-menu`
- `image-copy`
- `image-lightbox-counter`
- `image-lightbox-current`
- `image-lightbox-dialog`
- `image-lightbox-next`
- `image-lightbox-prev`

## run (7)

- `run-console-clear`
- `run-console-drawer`
- `run-console-drawer-toggle`
- `run-console-log-area`
- `run-console-log-lines`
- `run-console-resize`
- `run-terminal-${…}`

## editor (6)

- `editor-comment-widget-send`
- `editor-context-menu`
- `editor-context-menu-copy`
- `editor-references-panel`
- `editor-references-panel-close`
- `editor-tab`

## git (6)

- `git-branch-group-${…}`
- `git-conflict-abort`
- `git-conflict-view`
- `git-new-branch-cancel`
- `git-new-branch-start-option-${…}`
- `git-rename-cancel`

## sidebar (6)

- `sidebar-collapse`
- `sidebar-project-badge-all`
- `sidebar-project-unavailable-${…}`
- `sidebar-projects-toggle`
- `sidebar-scroll`
- `sidebar-update-pill`

## smart (6)

- `smart-action-instruction-append`
- `smart-action-instruction-new-session`
- `smart-action-url-open`
- `smart-action-url-open-browser`
- `smart-action-url-open-in-app`
- `smart-action-url-stop-tunnel`

## main (5)

- `main-surface-shell`
- `main-toolbar`
- `main-toolbar-branch-wt`
- `main-toolbar-search-hint`
- `main-toolbar-theme`

## named (5)

- `named-tunnel-clear-config`
- `named-tunnel-save`
- `named-tunnel-toggle`
- `named-tunnel-token-input`
- `named-tunnel-url-input`

## search (5)

- `search-card-error-body`
- `search-card-path`
- `search-card-plain-body`
- `search-card-root`
- `search-palette-footer`

## workspace (5)

- `workspace-pane-open-url-${…}`
- `workspace-surface-drag`
- `workspace-tab-stop-${…}`
- `workspace-url-entry`
- `workspace-url-entry-input`

## worktree (5)

- `worktree-switch-accept`
- `worktree-switch-banner`
- `worktree-switch-dismiss`
- `worktree-switch-row`
- `worktree-switch-status`

## file (4)

- `file-picker-loading`
- `file-tree-copy-path`
- `file-tree-copy-relative-path`
- `file-tree-reveal`

## push (4)

- `push-notification-card-error-body`
- `push-notification-card-message`
- `push-notification-card-result`
- `push-notification-card-root`

## thread (4)

- `thread-find-close`
- `thread-find-input`
- `thread-find-next`
- `thread-find-prev`

## toast (4)

- `toast-details-body`
- `toast-details-close`
- `toast-details-copy`
- `toast-details-dialog`

## web (4)

- `web-fetch-card-error-body`
- `web-fetch-card-root`
- `web-fetch-card-summary`
- `web-fetch-card-url`

## directory (3)

- `directory-picker-load-error-${…}`
- `directory-picker-loading`
- `directory-picker-node-loading-${…}`

## error (3)

- `error-state-copy`
- `error-state-reload`
- `error-state-retry`

## external (3)

- `external-session-branch`
- `external-session-item`
- `external-session-worktree`

## pairing (3)

- `pairing-code-copy`
- `pairing-generate-code`
- `pairing-regenerate-code`

## read (3)

- `read-card-code-preview`
- `read-card-error-body`
- `read-card-root`

## tunnel (3)

- `tunnel-recheck-verify`
- `tunnel-url-copy-ready`
- `tunnel-url-copy-unreachable`

## app (2)

- `app-shell-root`
- `app-waiting-daemon`

## edit (2)

- `edit-card-diff-raw`
- `edit-card-diff-unavailable`

## find (2)

- `find-bar`
- `find-in-path-error`

## remote (2)

- `remote-access-device-remove-${…}`
- `remote-access-port-tunnel-stop-${…}`

## archived (1)

- `archived-session-item`

## gate (1)

- `gate-head-tile`

## import (1)

- `import-session-btn`

## new (1)

- `new-session-initialization-retry`

## quick (1)

- `quick-tunnel-toggle`

## restore (1)

- `restore-session-btn`

## setup (1)

- `setup-advisor-section-${…}`

## surface (1)

- `surface-rail`
