# e2e — test-ids not referenced by any test

_Generated 2026-08-11. Source: packages/ui/src data-testids (1090) minus e2e references
(554). Unused: 536._

> "Unused" means the test-id string isn't referenced in a Playwright locator or passed as a bare
> string to a helper. Some of these elements ARE exercised via role/text locators (e.g. permission
> buttons via getByRole), so this lists selector gaps, not necessarily untested behavior. `${…}`
> marks templated id families.

## automations (96)

- `automations-blank-build`
- `automations-blank-describe`
- `automations-blank-state`
- `automations-condition-${…}`
- `automations-condition-add-${…}`
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
- `automations-file-item${…}`
- `automations-if-add-condition-${…}`
- `automations-if-add-otherwise-${…}`
- `automations-if-match-all`
- `automations-if-match-any`
- `automations-if-remove-otherwise-${…}`
- `automations-library-edit-${…}`
- `automations-library-error`
- `automations-library-error-banner`
- `automations-library-error-retry`
- `automations-library-last-run-${…}`
- `automations-library-new`
- `automations-library-retry`
- `automations-library-run-${…}`
- `automations-library-toggle-${…}`
- `automations-loop-max-${…}`
- `automations-loop-mode-${…}`
- `automations-loop-recipe-${…}`
- `automations-parallel-add-branch-${…}`
- `automations-parallel-branch-${…}`
- `automations-parallel-branch-remove-${…}`
- `automations-parallel-recipe-${…}`
- `automations-parallel-remove-confirm-${…}`
- `automations-recipe-${…}`
- `automations-recipe-root`
- `automations-repeat-concurrency-${…}`
- `automations-repeat-concurrency-caveat-${…}`
- `automations-repeat-concurrency-mode-${…}`
- `automations-repeat-items-${…}`
- `automations-repeat-items-picker-${…}`
- `automations-retry-attempts-${…}`
- `automations-retry-recipe-${…}`
- `automations-retry-warning-${…}`
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
- `automations-sidebar-empty`
- `automations-sidebar-error`
- `automations-sidebar-loading`
- `automations-sidebar-row-${…}`
- `automations-sidebar-row-status`
- `automations-skill-item${…}`
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

## chat (74)

- `chat-ask-answer-notes`
- `chat-ask-answer-preview`
- `chat-ask-question-text`
- `chat-ask-trigger`
- `chat-capture-selector`
- `chat-compact-elapsed`
- `chat-compact-row-${…}`
- `chat-compact-transcript`
- `chat-compacting-pill`
- `chat-composer-cancel`
- `chat-composer-edit-cancel`
- `chat-composer-edit-save`
- `chat-composer-edit-toolbar`
- `chat-composer-toolbar`
- `chat-context-not-preserved-${…}`
- `chat-context-not-preserved-dismiss-${…}`
- `chat-degraded-continue`
- `chat-degraded-error`
- `chat-edit-error-text`
- `chat-edit-trigger`
- `chat-error-block`
- `chat-fileref-${…}`
- `chat-fileref-open-${…}`
- `chat-header-parent-link`
- `chat-image-zoom-dialog`
- `chat-image-zoom-image`
- `chat-image-zoom-trigger`
- `chat-link-copy`
- `chat-link-copy-url`
- `chat-markdown-table-scroll`
- `chat-message-session-chip-${…}`
- `chat-plan-exec-mode`
- `chat-plan-revise-cancel`
- `chat-provider-keeps-transcript-${…}`
- `chat-question-text`
- `chat-queued-bubble`
- `chat-reasoning-toggle`
- `chat-slash-command-args`
- `chat-split-divider`
- `chat-split-row`
- `chat-system-message`
- `chat-thread-area`
- `chat-thread-load-error`
- `chat-thread-load-retry`
- `chat-thread-loading`
- `chat-thread-running-elapsed`
- `chat-thread-running-text`
- `chat-tool-fallback-error`
- `chat-tool-fallback-images`
- `chat-user-attachment-${…}`
- `chat-user-attachments`
- `chat-user-message-send-error`
- `chat-user-snippet-expand-${…}`
- `chat-user-snippet-scroll-${…}`
- `chat-work-toggle-${…}`
- `chat-workflow-agent-${…}`
- `chat-workflow-agent-note-${…}`
- `chat-workflow-agent-toggle-${…}`
- `chat-workflow-launcher-${…}`
- `chat-workflow-launcher-dot`
- `chat-workflow-panel-${…}`
- `chat-workflow-phase-${…}`
- `chat-workflow-phase-toggle-${…}`
- `chat-workflow-phase-unassigned`
- `chat-workflow-rail`
- `chat-workflow-stale-banner-${…}`
- `chat-workflow-status-pill`
- `chat-workflow-upnext`
- `chat-workflow-upnext-${…}`
- `chat-workflow-upnext-toggle`
- `chat-write-error-text`
- `chat-zone-${…}`
- `chat-zone-close-${…}`
- `chat-zone-strip-${…}`

## tasks (49)

- `tasks-board-loading`
- `tasks-edit-body`
- `tasks-github-banner`
- `tasks-github-banner-dismiss`
- `tasks-github-banner-report`
- `tasks-github-credential`
- `tasks-github-credential-connected`
- `tasks-github-credential-replace`
- `tasks-github-import-all`
- `tasks-github-import-cancel`
- `tasks-github-import-confirm`
- `tasks-github-import-dialog`
- `tasks-github-import-error`
- `tasks-github-import-issue-${…}`
- `tasks-github-import-update-token`
- `tasks-github-link`
- `tasks-github-link-cancel`
- `tasks-github-link-confirm`
- `tasks-github-link-dialog`
- `tasks-github-menu-import`
- `tasks-github-menu-report`
- `tasks-github-menu-sync`
- `tasks-github-menu-token`
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
- `tasks-github-token`
- `tasks-github-token-dialog`
- `tasks-github-unlink-dialog`
- `tasks-priority-dot-${…}`
- `tasks-quick-feature`
- `tasks-quick-project`
- `tasks-sidebar-cycle-${…}`
- `tasks-sidebar-edit-${…}`
- `tasks-sidebar-empty`
- `tasks-sidebar-group-${…}`
- `tasks-sidebar-group-toggle-${…}`
- `tasks-sidebar-loading`
- `tasks-sidebar-new`
- `tasks-sidebar-no-project`
- `tasks-sidebar-row-${…}`
- `tasks-sidebar-start-${…}`

## sessions (40)

- `sessions-archive-cancel`
- `sessions-ctx-fork`
- `sessions-ctx-open-split`
- `sessions-ctx-side-chat`
- `sessions-draft-row-title`
- `sessions-firstrun-no-project`
- `sessions-import-back`
- `sessions-meta-card`
- `sessions-meta-card-fork-count`
- `sessions-meta-card-forked-from`
- `sessions-meta-card-label-${…}`
- `sessions-meta-card-no-project`
- `sessions-meta-card-pr`
- `sessions-meta-card-tags`
- `sessions-meta-card-title`
- `sessions-meta-card-worktree`
- `sessions-more-menu`
- `sessions-row-fork-nest`
- `sessions-row-fork-nest-2`
- `sessions-row-fork-nest-glyph`
- `sessions-row-hint`
- `sessions-row-meta`
- `sessions-row-meta-glyphs`
- `sessions-row-meta-pr`
- `sessions-row-meta-tag-dots`
- `sessions-row-no-project`
- `sessions-row-parent-link`
- `sessions-row-pin-glyph`
- `sessions-row-project`
- `sessions-row-provider`
- `sessions-row-provider-logo`
- `sessions-row-temporary-glyph`
- `sessions-row-your-turn`
- `sessions-scope-more`
- `sessions-scope-strip`
- `sessions-section`
- `sessions-tag-filter-clear`
- `sessions-tag-filter-synthetic-${…}`
- `sessions-tag-popover-error`
- `sessions-welcome-suggestion-insert-${…}`

## settings (24)

- `settings-about-homedir`
- `settings-config-conflicts-warning`
- `settings-default-provider-option-${…}`
- `settings-default-provider-option-auto`
- `settings-default-provider-select`
- `settings-keybinding-conflict-${…}`
- `settings-keybinding-record-${…}`
- `settings-keybinding-reset-${…}`
- `settings-keybinding-row-${…}`
- `settings-keybinding-steal-${…}`
- `settings-keybindings-group-${…}`
- `settings-keybindings-reset-all`
- `settings-notify-attention-request-toggle`
- `settings-notify-plan-approval-toggle`
- `settings-notify-plugin-toggle`
- `settings-notify-tool-request-toggle`
- `settings-notify-user-question-toggle`
- `settings-pane-about`
- `settings-pane-general`
- `settings-pane-keybindings`
- `settings-pane-notifications`
- `settings-pane-providers`
- `settings-pane-remote-access`
- `settings-remote-access-port-tunnels-section`

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

## session (21)

- `session-panel-launch-spinner-${…}`
- `session-panel-section-prs`
- `session-panel-sections`
- `session-panel-summary-empty`
- `session-panel-summary-pr-${…}`
- `session-panel-tasks-attachments`
- `session-panel-tasks-attachments-clear`
- `session-panel-workflow-${…}`
- `session-panel-workflow-back-${…}`
- `session-tab-ctx-close`
- `session-tab-ctx-close-split`
- `session-tab-ctx-fork`
- `session-tab-ctx-keep-open`
- `session-tab-ctx-open-split`
- `session-tab-ctx-side-chat`
- `session-tab-hint-${…}`
- `session-tab-open-beside-${…}`
- `session-tab-provider-${…}`
- `session-tab-waiting-${…}`
- `session-tabs`
- `session-tabs-zone-group`

## composer (17)

- `composer-adapter-logo-${…}`
- `composer-attachments`
- `composer-command-item-${…}`
- `composer-context-percent`
- `composer-dropzone`
- `composer-mention-session-${…}`
- `composer-model-current`
- `composer-model-group-header-${…}`
- `composer-model-older-header`
- `composer-model-provider-dot`
- `composer-segment`
- `composer-segment-input`
- `composer-temporary-toggle`
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

## url (12)

- `url-tab-annotation-backdrop`
- `url-tab-body-blank`
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

## viewer (8)

- `viewer-csv-preview-toggle`
- `viewer-csv-source`
- `viewer-csv-source-toggle`
- `viewer-unsupported`
- `viewer-unsupported-card`
- `viewer-unsupported-icon-chip`
- `viewer-unsupported-open`
- `viewer-unsupported-reveal`

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

## image (6)

- `image-context-menu`
- `image-copy`
- `image-lightbox-counter`
- `image-lightbox-current`
- `image-lightbox-next`
- `image-lightbox-prev`

## side (6)

- `side-chat-close-${…}`
- `side-chat-collapse-${…}`
- `side-chat-divider-${…}`
- `side-chat-header-${…}`
- `side-chat-panel-${…}`
- `side-chat-toggle-${…}`

## workspace (6)

- `workspace-pane-close-${…}`
- `workspace-pane-open-url-${…}`
- `workspace-picker-recent-${…}`
- `workspace-tab-stop-${…}`
- `workspace-url-entry`
- `workspace-url-entry-input`

## git (5)

- `git-branch-group-${…}`
- `git-new-branch-cancel`
- `git-new-branch-start-option-${…}`
- `git-rename-cancel`
- `git-submenu-rebase`

## push (5)

- `push-notification-card-error-body`
- `push-notification-card-message`
- `push-notification-card-result`
- `push-notification-card-root`
- `push-notification-card-trigger`

## smart (5)

- `smart-action-instruction-append`
- `smart-action-instruction-new-session`
- `smart-action-url-copy`
- `smart-action-url-open`
- `smart-action-url-stop-tunnel`

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

## shell (4)

- `shell-rail`
- `shell-rail-appearance`
- `shell-rail-automations-pending`
- `shell-rail-update`

## toast (4)

- `toast-details-body`
- `toast-details-close`
- `toast-details-copy`
- `toast-details-dialog`

## tool (4)

- `tool-card-path-open`
- `tool-card-status-dot`
- `tool-result-expand-collapse`
- `tool-result-image-${…}`

## zone (4)

- `zone-drop-left`
- `zone-drop-right`
- `zone-drop-split`
- `zone-drop-split-left`

## pairing (3)

- `pairing-code-copy`
- `pairing-generate-code`
- `pairing-regenerate-code`

## review (3)

- `review-commit-error`
- `review-file-status-${…}`
- `review-load-error`

## shortcuts (3)

- `shortcuts-cheat-sheet`
- `shortcuts-cheat-sheet-group-${…}`
- `shortcuts-cheat-sheet-row-${…}`

## sidebar (3)

- `sidebar-collapse`
- `sidebar-scroll`
- `sidebar-search`

## thread (3)

- `thread-find-close`
- `thread-find-next`
- `thread-find-prev`

## title (3)

- `title-bar-actions`
- `title-bar-chat-column`
- `title-bar-sidebar-section`

## tunnel (3)

- `tunnel-recheck-verify`
- `tunnel-url-copy-ready`
- `tunnel-url-copy-unreachable`

## app (2)

- `app-shell-root`
- `app-waiting-daemon`

## csv (2)

- `csv-note-add-${…}`
- `csv-note-marker-${…}`

## directory (2)

- `directory-picker-load-error-${…}`
- `directory-picker-node-loading-${…}`

## edit (2)

- `edit-card-diff-raw`
- `edit-card-diff-unavailable`

## external (2)

- `external-session-branch`
- `external-session-worktree`

## file (2)

- `file-picker-loading`
- `file-tree-keep-open-${…}`

## md (2)

- `md-note-add-${…}`
- `md-note-marker-${…}`

## named (2)

- `named-tunnel-clear-config`
- `named-tunnel-toggle`

## remote (2)

- `remote-access-device-remove-${…}`
- `remote-access-port-tunnel-stop-${…}`

## web (2)

- `web-fetch-card-error-body`
- `web-fetch-card-no-target`

## confirm (1)

- `confirm-dialog`

## content (1)

- `content-card`

## dialog (1)

- `dialog-resize-grabber-${…}`

## find (1)

- `find-in-path-error`

## gate (1)

- `gate-head-tile`

## main (1)

- `main-surface-shell`

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

## welcome (1)

- `welcome-project-picker-no-project`
