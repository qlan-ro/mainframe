# Changelog

## 0.12.0


### Minor Changes

- [#232](https://github.com/qlan-ro/mainframe/pull/232) [`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.

- [#231](https://github.com/qlan-ro/mainframe/pull/231) [`753ccae`](https://github.com/qlan-ro/mainframe/commit/753ccae7c4ac7e2c9a9101d1b98dc80606a7d4f5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an Archive button to the chat panel header that opens a popover listing archived sessions with a Restore action. Archived chats stay hidden from the main list.

### Patch Changes

- [#233](https://github.com/qlan-ro/mainframe/pull/233) [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix queued messages not clearing from the composer ([#116](https://github.com/qlan-ro/mainframe/issues/116)).

  The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:
  - Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
  - Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
  - Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
  - Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
  - Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.

- Updated dependencies [[`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342), [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831)]:
  - @qlan-ro/mainframe-types@0.12.0


### Minor Changes

- [#230](https://github.com/qlan-ro/mainframe/pull/230) [`29f192c`](https://github.com/qlan-ro/mainframe/commit/29f192c95f9507a6625e42d134fe599cb3f000b1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a project from the sidebar. Two discoverable entry points route through the same confirm-and-cleanup flow:
  - Hover the project group header (in the "All" view) → trash icon fades in next to "New Session".
  - When filtered to a specific project, the active filter pill shows a chevron — clicking it opens a menu with "Delete Project".

  Confirming stops all running CLI sessions in that project, removes all its chats from the database in a transaction, and resets any active filter or selected chat that belonged to the deleted project. Files on disk are not affected.

- [#232](https://github.com/qlan-ro/mainframe/pull/232) [`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.

- [#231](https://github.com/qlan-ro/mainframe/pull/231) [`753ccae`](https://github.com/qlan-ro/mainframe/commit/753ccae7c4ac7e2c9a9101d1b98dc80606a7d4f5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an Archive button to the chat panel header that opens a popover listing archived sessions with a Restore action. Archived chats stay hidden from the main list.

### Patch Changes

- [#233](https://github.com/qlan-ro/mainframe/pull/233) [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix queued messages not clearing from the composer ([#116](https://github.com/qlan-ro/mainframe/issues/116)).

  The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:
  - Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
  - Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
  - Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
  - Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
  - Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.

- Updated dependencies [[`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342), [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831), [`753ccae`](https://github.com/qlan-ro/mainframe/commit/753ccae7c4ac7e2c9a9101d1b98dc80606a7d4f5)]:
  - @qlan-ro/mainframe-types@0.12.0
  - @qlan-ro/mainframe-core@0.12.0


### Minor Changes

- [#232](https://github.com/qlan-ro/mainframe/pull/232) [`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.

### Patch Changes

- [#233](https://github.com/qlan-ro/mainframe/pull/233) [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix queued messages not clearing from the composer ([#116](https://github.com/qlan-ro/mainframe/issues/116)).

  The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:
  - Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
  - Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
  - Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
  - Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
  - Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.


## 0.11.1


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.11.1


### Patch Changes

- [#228](https://github.com/qlan-ro/mainframe/pull/228) [`7b82949`](https://github.com/qlan-ro/mainframe/commit/7b829498cad870ae239f7aea607bae7a6e249f23) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(updater): publish macOS zip artifact so electron-updater can apply updates

  Squirrel.Mac auto-updates require a `.zip` of the app bundle; the release previously shipped only `.dmg`, causing the updater to fail with "ZIP file not provided" when applying an update. Also replaces native `title` attributes on the status-bar update indicator and the composer worktree button with Radix tooltips so hovercards render with the app's own styling, re-enables hoverable content on the chat link-preview tooltip so the Copy button can be reached, and adds a right-click context menu to chat links with Copy link / Open link actions.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.11.1
  - @qlan-ro/mainframe-core@0.11.1


## 0.11.0


### Minor Changes

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a git worktree directly from the branches popover, with a native confirm dialog and a new POST /api/projects/:id/git/delete-worktree endpoint on the daemon.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added a "+" button to each worktree row in the branches popover that starts a new Claude session already attached to that worktree. The `chat.create` WebSocket message now accepts optional paired `worktreePath` and `branchName` fields, so the attachment happens atomically when the chat is born.

### Patch Changes

- [#221](https://github.com/qlan-ro/mainframe/pull/221) [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805) Thanks [@doruchiulan](https://github.com/doruchiulan)! - File search now surfaces gitignored config files (e.g. .env) while still excluding build artifacts like node_modules and dist.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.11.0


### Minor Changes

- [#221](https://github.com/qlan-ro/mainframe/pull/221) [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805) Thanks [@doruchiulan](https://github.com/doruchiulan)! - `@`-picker gains terminal-style path autocomplete. Typing `/` in an `@`-token switches from fuzzy search to tree navigation; Tab completes filenames; Enter on a directory drills in.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a git worktree directly from the branches popover, with a native confirm dialog and a new POST /api/projects/:id/git/delete-worktree endpoint on the daemon.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added a "+" button to each worktree row in the branches popover that starts a new Claude session already attached to that worktree. The `chat.create` WebSocket message now accepts optional paired `worktreePath` and `branchName` fields, so the attachment happens atomically when the chat is born.

### Patch Changes

- [#224](https://github.com/qlan-ro/mainframe/pull/224) [`29cddc7`](https://github.com/qlan-ro/mainframe/commit/29cddc7a0a9531fa0acfdebb84e1da6ec6c6afd9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer now preserves newlines in sent messages and caps its growth at a max height with internal scroll.

  The max-height cap is applied to an outer scroll wrapper rather than the textarea itself, so the textarea grows naturally and shares its wrapping width with the highlight overlay. With the cap on the textarea, its own scrollbar shaved the effective content width, causing the two layers to wrap at different widths and the caret to drift from the visible text. The overlay also emits a trailing zero-width marker so the caret stays aligned when the text ends with a newline.

  The global text selection color is now a neutral blue instead of the orange accent, so mentions and other accent-colored text stay readable while selected.

  The highlight overlay now seeds its text from the runtime's current state on mount instead of waiting for a subscribe event, so draft text stays visible after ancestors remount (for example, when a permission prompt closes).

- [#222](https://github.com/qlan-ro/mainframe/pull/222) [`1ee5874`](https://github.com/qlan-ro/mainframe/commit/1ee5874732bd683cdb1d379f13c72923d9031027) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session list view mode is now derived from the project filter. Grouped view is used when 'All' is selected; flat view is used when filtering by a single project. The manual toggle is gone.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - While a worktree delete is in flight, show a spinner on that row's trash icon and disable both the trash and new-session buttons. Other worktree rows remain interactive.

- Updated dependencies [[`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec), [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805), [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec)]:
  - @qlan-ro/mainframe-core@0.11.0
  - @qlan-ro/mainframe-types@0.11.0


## 0.10.3


### Patch Changes

- [#216](https://github.com/qlan-ro/mainframe/pull/216) [`4874e77`](https://github.com/qlan-ro/mainframe/commit/4874e7789d5162a8ae5e51e1a153b08f7c11dd22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Files Tree in worktrees: "Copy Path" and "Reveal in Finder" now use the active chat's worktree path instead of the main project path. Also adds symlink support — symlinks to directories are expandable, symlinks to files are listed as files, and broken symlinks are skipped.

- [#220](https://github.com/qlan-ro/mainframe/pull/220) [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Claude CLI model probe silently timing out and surface the tier-resolved default model in the UI.
  - Probe now reads the initialize payload from the nested `response.response.models` path the CLI uses when `subtype === 'success'` (previously always fell back to the hardcoded list).
  - `AdapterModel` gains `description` and `isDefault` so the renderer can show what the CLI picks on the current tier.
  - Claude adapter now has a hardcoded `default` entry (labelled `Default - Opus 4.7`, the current upstream default on Max) as the pre-probe stand-in for the CLI's `"default"` alias; the probe replaces it with the live one when it succeeds.
  - Probed labels are derived from the CLI's description (e.g. `Sonnet 4.6`, `Sonnet 4.6 with 1M context`, `Haiku 4.5`); the `default` entry renders as `Default - <resolved model>`.
  - Settings and composer model pickers show descriptions in Radix tooltips on row hover, and the composer keeps legacy/tier-specific chat model ids readable by falling back to `getModelLabel`.

- Updated dependencies [[`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65)]:
  - @qlan-ro/mainframe-types@0.10.3


### Patch Changes

- [#216](https://github.com/qlan-ro/mainframe/pull/216) [`4874e77`](https://github.com/qlan-ro/mainframe/commit/4874e7789d5162a8ae5e51e1a153b08f7c11dd22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Files Tree in worktrees: "Copy Path" and "Reveal in Finder" now use the active chat's worktree path instead of the main project path. Also adds symlink support — symlinks to directories are expandable, symlinks to files are listed as files, and broken symlinks are skipped.

- [#220](https://github.com/qlan-ro/mainframe/pull/220) [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Claude CLI model probe silently timing out and surface the tier-resolved default model in the UI.
  - Probe now reads the initialize payload from the nested `response.response.models` path the CLI uses when `subtype === 'success'` (previously always fell back to the hardcoded list).
  - `AdapterModel` gains `description` and `isDefault` so the renderer can show what the CLI picks on the current tier.
  - Claude adapter now has a hardcoded `default` entry (labelled `Default - Opus 4.7`, the current upstream default on Max) as the pre-probe stand-in for the CLI's `"default"` alias; the probe replaces it with the live one when it succeeds.
  - Probed labels are derived from the CLI's description (e.g. `Sonnet 4.6`, `Sonnet 4.6 with 1M context`, `Haiku 4.5`); the `default` entry renders as `Default - <resolved model>`.
  - Settings and composer model pickers show descriptions in Radix tooltips on row hover, and the composer keeps legacy/tier-specific chat model ids readable by falling back to `getModelLabel`.

- [#217](https://github.com/qlan-ro/mainframe/pull/217) [`442782b`](https://github.com/qlan-ro/mainframe/commit/442782b2719ec715d7d72f294d48ce1447b8e252) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Include task title in the "Task created" toast so it matches the notification body removed in the earlier dedup fix.

- Updated dependencies [[`4874e77`](https://github.com/qlan-ro/mainframe/commit/4874e7789d5162a8ae5e51e1a153b08f7c11dd22), [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65)]:
  - @qlan-ro/mainframe-core@0.10.3
  - @qlan-ro/mainframe-types@0.10.3


### Patch Changes

- [#220](https://github.com/qlan-ro/mainframe/pull/220) [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Claude CLI model probe silently timing out and surface the tier-resolved default model in the UI.
  - Probe now reads the initialize payload from the nested `response.response.models` path the CLI uses when `subtype === 'success'` (previously always fell back to the hardcoded list).
  - `AdapterModel` gains `description` and `isDefault` so the renderer can show what the CLI picks on the current tier.
  - Claude adapter now has a hardcoded `default` entry (labelled `Default - Opus 4.7`, the current upstream default on Max) as the pre-probe stand-in for the CLI's `"default"` alias; the probe replaces it with the live one when it succeeds.
  - Probed labels are derived from the CLI's description (e.g. `Sonnet 4.6`, `Sonnet 4.6 with 1M context`, `Haiku 4.5`); the `default` entry renders as `Default - <resolved model>`.
  - Settings and composer model pickers show descriptions in Radix tooltips on row hover, and the composer keeps legacy/tier-specific chat model ids readable by falling back to `getModelLabel`.


## 0.10.2


### Patch Changes

- [#209](https://github.com/qlan-ro/mainframe/pull/209) [`fa0b079`](https://github.com/qlan-ro/mainframe/commit/fa0b079dac8ef37c7e866ee4bb27e1ef54dfc306) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Downgrade launch spawn failures and auto-updater network errors to `warn` and drop stack traces. These are expected user-config / connectivity conditions, not application errors.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.10.2


### Patch Changes

- [#209](https://github.com/qlan-ro/mainframe/pull/209) [`fa0b079`](https://github.com/qlan-ro/mainframe/commit/fa0b079dac8ef37c7e866ee4bb27e1ef54dfc306) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Downgrade launch spawn failures and auto-updater network errors to `warn` and drop stack traces. These are expected user-config / connectivity conditions, not application errors.

- [#211](https://github.com/qlan-ro/mainframe/pull/211) [`e68cc02`](https://github.com/qlan-ro/mainframe/commit/e68cc0208812a6b308fee2d97d7859a443cdf323) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Prevent `TurnFooter` crashes from bringing down the whole chat turn, and log renderer-process crashes so blank-screen bugs leave a trace.
  - `TurnFooter`: local error boundary. `assistant-ui`'s `tapClientLookup` can throw `"Index N out of bounds (length: N)"` during concurrent renders when the external messages array shrinks between a parent capturing its index and a descendant hook reading it. The boundary scopes the failure to the footer and auto-resets on the next render; the rest of the turn keeps rendering.
  - `main`: listen for `render-process-gone` and log `{ reason, exitCode }`. Renderer crashes (OOM, GPU, killed) previously left no trace because React `ErrorBoundary` only catches render errors, not process-level failures.

- Updated dependencies [[`fa0b079`](https://github.com/qlan-ro/mainframe/commit/fa0b079dac8ef37c7e866ee4bb27e1ef54dfc306)]:
  - @qlan-ro/mainframe-core@0.10.2
  - @qlan-ro/mainframe-types@0.10.2


## 0.10.1


### Patch Changes

- [#206](https://github.com/qlan-ro/mainframe/pull/206) [`e6e6842`](https://github.com/qlan-ro/mainframe/commit/e6e6842e477642d9f74b63cd2585cf4e36f7106b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.10.1


### Patch Changes

- [#206](https://github.com/qlan-ro/mainframe/pull/206) [`e6e6842`](https://github.com/qlan-ro/mainframe/commit/e6e6842e477642d9f74b63cd2585cf4e36f7106b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- Updated dependencies [[`e6e6842`](https://github.com/qlan-ro/mainframe/commit/e6e6842e477642d9f74b63cd2585cf4e36f7106b)]:
  - @qlan-ro/mainframe-core@0.10.1
  - @qlan-ro/mainframe-types@0.10.1


## 0.10.0


### Minor Changes

- [#196](https://github.com/qlan-ro/mainframe/pull/196) [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect GitHub PRs created during sessions and display a PR badge in the chat header. Distinguish created vs mentioned PRs using command-level detection (gh pr create, glab mr create, az repos pr create). Created PRs get a green badge and session list icon; mentioned PRs get a muted badge.

- [#197](https://github.com/qlan-ro/mainframe/pull/197) [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session pinning to keep important sessions at the top of the list

### Patch Changes

- [#190](https://github.com/qlan-ro/mainframe/pull/190) [`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- [#194](https://github.com/qlan-ro/mainframe/pull/194) [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make files tab the default right panel tab, fix root directory tooltip regression, fix duplicated todo creation notifications

- [#200](https://github.com/qlan-ro/mainframe/pull/200) [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Changes tab not refreshing when subagents modify files

- Updated dependencies [[`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b), [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4), [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145)]:
  - @qlan-ro/mainframe-types@0.10.0


### Minor Changes

- [#198](https://github.com/qlan-ro/mainframe/pull/198) [`6e90f97`](https://github.com/qlan-ro/mainframe/commit/6e90f97acf021565a1202f731c2510b147618ad0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add automatic update checking with status bar indicator

- [#196](https://github.com/qlan-ro/mainframe/pull/196) [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect GitHub PRs created during sessions and display a PR badge in the chat header. Distinguish created vs mentioned PRs using command-level detection (gh pr create, glab mr create, az repos pr create). Created PRs get a green badge and session list icon; mentioned PRs get a muted badge.

- [#197](https://github.com/qlan-ro/mainframe/pull/197) [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session pinning to keep important sessions at the top of the list

- [#191](https://github.com/qlan-ro/mainframe/pull/191) [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add tool window registry and ZoneId type for IntelliJ-style dockable panels

### Patch Changes

- [#190](https://github.com/qlan-ro/mainframe/pull/190) [`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- [#194](https://github.com/qlan-ro/mainframe/pull/194) [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make files tab the default right panel tab, fix root directory tooltip regression, fix duplicated todo creation notifications

- [#189](https://github.com/qlan-ro/mainframe/pull/189) [`afd0178`](https://github.com/qlan-ro/mainframe/commit/afd017863747e4acf41ea614b4642e6619b984db) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix memory leak: clean Maps on chat removal, add message eviction caps, unsubscribe inactive chats, cap nav stacks, clear LSP URIs

- [#200](https://github.com/qlan-ro/mainframe/pull/200) [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Changes tab not refreshing when subagents modify files

- [#199](https://github.com/qlan-ro/mainframe/pull/199) [`f7c1133`](https://github.com/qlan-ro/mainframe/commit/f7c1133908a30ea0ea18c45fd5272b6ddd6fe87e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix terminal resize corruption by guarding fitAddon against zero dimensions and debouncing resize events

- [#201](https://github.com/qlan-ro/mainframe/pull/201) [`80026fd`](https://github.com/qlan-ro/mainframe/commit/80026fdaea261661e9d79e5a4ec8bd8b714c6112) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Re-wire file editor into center panel split after zone-based layout rewrite

- [#193](https://github.com/qlan-ro/mainframe/pull/193) [`e26c46c`](https://github.com/qlan-ro/mainframe/commit/e26c46c2124dcb0baf679e8a5c2e572c786e86cd) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Parallelize startup API calls, lazy-load infrequent chat cards, add passive scroll listener

- [#195](https://github.com/qlan-ro/mainframe/pull/195) [`a6a3bd7`](https://github.com/qlan-ro/mainframe/commit/a6a3bd789454c74a39e9a7268611acc48cf4d76b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Optimize Zustand store selectors and add React.memo to list components to reduce re-renders

- Updated dependencies [[`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5), [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e), [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b), [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4), [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1), [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145)]:
  - @qlan-ro/mainframe-core@0.10.0
  - @qlan-ro/mainframe-types@0.10.0


### Minor Changes

- [#196](https://github.com/qlan-ro/mainframe/pull/196) [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect GitHub PRs created during sessions and display a PR badge in the chat header. Distinguish created vs mentioned PRs using command-level detection (gh pr create, glab mr create, az repos pr create). Created PRs get a green badge and session list icon; mentioned PRs get a muted badge.

- [#197](https://github.com/qlan-ro/mainframe/pull/197) [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session pinning to keep important sessions at the top of the list

- [#191](https://github.com/qlan-ro/mainframe/pull/191) [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add tool window registry and ZoneId type for IntelliJ-style dockable panels


## 0.9.0


### Minor Changes

- [#182](https://github.com/qlan-ro/mainframe/pull/182) [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show Claude's TodoWrite task checklist in the Context tab

### Patch Changes

- [#181](https://github.com/qlan-ro/mainframe/pull/181) [`0d1b34f`](https://github.com/qlan-ro/mainframe/commit/0d1b34f8e41b65b3474a41c3fc18cdcd762bb6f4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Append system prompt to Claude sessions instructing use of AskUserQuestion tool

- [#185](https://github.com/qlan-ro/mainframe/pull/185) [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service

- Updated dependencies [[`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f), [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22)]:
  - @qlan-ro/mainframe-types@0.9.0


### Minor Changes

- [#185](https://github.com/qlan-ro/mainframe/pull/185) [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add integrated terminal panel with node-pty and xterm.js

- [#182](https://github.com/qlan-ro/mainframe/pull/182) [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show Claude's TodoWrite task checklist in the Context tab

### Patch Changes

- [#184](https://github.com/qlan-ro/mainframe/pull/184) [`42efa20`](https://github.com/qlan-ro/mainframe/commit/42efa2069c59429f721f5fb01809ea406a4d3fb2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Allow app-protocol URLs (slack://, vscode://, figma://, etc.) to render as clickable links in chat messages

- Updated dependencies [[`0d1b34f`](https://github.com/qlan-ro/mainframe/commit/0d1b34f8e41b65b3474a41c3fc18cdcd762bb6f4), [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f), [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22)]:
  - @qlan-ro/mainframe-core@0.9.0
  - @qlan-ro/mainframe-types@0.9.0


### Minor Changes

- [#182](https://github.com/qlan-ro/mainframe/pull/182) [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show Claude's TodoWrite task checklist in the Context tab

### Patch Changes

- [#185](https://github.com/qlan-ro/mainframe/pull/185) [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service


## 0.8.1


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.8.1


### Patch Changes

- [#178](https://github.com/qlan-ro/mainframe/pull/178) [`80d7698`](https://github.com/qlan-ro/mainframe/commit/80d7698832270d83cb55185e32b697e98f607d89) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pass default model when creating new chat sessions and show compacting indicator

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.8.1
  - @qlan-ro/mainframe-core@0.8.1


## 0.8.0


### Minor Changes

- [#173](https://github.com/qlan-ro/mainframe/pull/173) [`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add dynamic Claude model list with CLI probe on startup

  Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.

### Patch Changes

- [#176](https://github.com/qlan-ro/mainframe/pull/176) [`4dd60b5`](https://github.com/qlan-ro/mainframe/commit/4dd60b5ad3a4a599491e47813a42ea5319c528f4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): read correct field path for context_usage control response

- [#172](https://github.com/qlan-ro/mainframe/pull/172) [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service

- Updated dependencies [[`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63), [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365)]:
  - @qlan-ro/mainframe-types@0.8.0


### Minor Changes

- [#175](https://github.com/qlan-ro/mainframe/pull/175) [`6a1107f`](https://github.com/qlan-ro/mainframe/commit/6a1107f6a10893725a433befb1dc834c3ac71df5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add "Copy Reference" context menu action to Monaco editors

### Patch Changes

- [#173](https://github.com/qlan-ro/mainframe/pull/173) [`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add dynamic Claude model list with CLI probe on startup

  Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.

- [#171](https://github.com/qlan-ro/mainframe/pull/171) [`27ee58a`](https://github.com/qlan-ro/mainframe/commit/27ee58af44a8019e3fc7f3152db2f358e3849201) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix preview URL not updating when switching to a worktree session

- Updated dependencies [[`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63), [`4dd60b5`](https://github.com/qlan-ro/mainframe/commit/4dd60b5ad3a4a599491e47813a42ea5319c528f4), [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365)]:
  - @qlan-ro/mainframe-types@0.8.0
  - @qlan-ro/mainframe-core@0.8.0


### Minor Changes

- [#173](https://github.com/qlan-ro/mainframe/pull/173) [`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add dynamic Claude model list with CLI probe on startup

  Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.

### Patch Changes

- [#172](https://github.com/qlan-ro/mainframe/pull/172) [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service


## 0.7.0


### Minor Changes

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements

- [#161](https://github.com/qlan-ro/mainframe/pull/161) [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): bigger titles, label autocomplete, and status change notifications

### Patch Changes

- [#153](https://github.com/qlan-ro/mainframe/pull/153) [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: replace slow JS content search with ripgrep for faster Find in Path on large projects. File name search now excludes .gitignore'd and binary files. Search palette is wider and resizable.

- [#159](https://github.com/qlan-ro/mainframe/pull/159) [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(git): add --ff-only to pull commands to prevent merge commits on divergent branches

- [#159](https://github.com/qlan-ro/mainframe/pull/159) [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(git): pass localBranch to pull service so non-current branches use fetch instead of ff-only pull

- Updated dependencies [[`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818), [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497), [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8), [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20)]:
  - @qlan-ro/mainframe-types@0.7.0


### Minor Changes

- [#163](https://github.com/qlan-ro/mainframe/pull/163) [`919fa40`](https://github.com/qlan-ro/mainframe/commit/919fa406bb5a006f49301a2e9d3841351f955e42) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(desktop): make file paths in tool cards clickable to open in editor

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#162](https://github.com/qlan-ro/mainframe/pull/162) [`58346d2`](https://github.com/qlan-ro/mainframe/commit/58346d2f9a217814241dfcce7e8fac48aac009f5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(desktop): session rename context menu, copy tool output, scroll to diff

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements

- [#158](https://github.com/qlan-ro/mainframe/pull/158) [`105deb5`](https://github.com/qlan-ro/mainframe/commit/105deb59ffcc59076e32362d4ea8f63c576c6999) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add sorting options (by number, priority, type) to the tasks board columns

- [#161](https://github.com/qlan-ro/mainframe/pull/161) [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): bigger titles, label autocomplete, and status change notifications

- [#167](https://github.com/qlan-ro/mainframe/pull/167) [`26b6bf7`](https://github.com/qlan-ro/mainframe/commit/26b6bf76e2e8f02c1dca1e11edd2257581ca74ff) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show unread and waiting count badges on project filter pills and bold unread session titles

### Patch Changes

- [#168](https://github.com/qlan-ro/mainframe/pull/168) [`c04af83`](https://github.com/qlan-ro/mainframe/commit/c04af838d05cc96107996989345b037be82e289b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Restore composer draft persistence across chat switches and clean up drafts on archive

- [#153](https://github.com/qlan-ro/mainframe/pull/153) [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: replace slow JS content search with ripgrep for faster Find in Path on large projects. File name search now excludes .gitignore'd and binary files. Search palette is wider and resizable.

- [#157](https://github.com/qlan-ro/mainframe/pull/157) [`8b9ce57`](https://github.com/qlan-ro/mainframe/commit/8b9ce57a6dfcd5d2ba26817e347ebf29e9519aed) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rename default session label from "New Chat" to "Untitled session" to match mobile

- Updated dependencies [[`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818), [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe), [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c), [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497), [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c), [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8), [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20), [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e)]:
  - @qlan-ro/mainframe-types@0.7.0
  - @qlan-ro/mainframe-core@0.7.0


### Minor Changes

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements


## 0.6.0


### Minor Changes

- [#138](https://github.com/qlan-ro/mainframe/pull/138) [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add plugin action API and quick-create todo dialog (Cmd+T)

### Patch Changes

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix composer draft preservation, kill launch processes on worktree archive, add copy relative path

- [#142](https://github.com/qlan-ro/mainframe/pull/142) [`511c44d`](https://github.com/qlan-ro/mainframe/commit/511c44d36cce05a9a4a8f40945b5751e7c5716f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: stop button now works when background subagents are running

  Send SIGINT to CLI child process on interrupt to bypass the blocked stdin
  message loop. Also prevent message loss from the interrupt race condition
  by waiting for the process to fully exit before respawning.

- [#149](https://github.com/qlan-ro/mainframe/pull/149) [`c3c97ed`](https://github.com/qlan-ro/mainframe/commit/c3c97ed495071064cf94399a1bde00922af3990d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: branch manager bugfixes — pull safety, conflict detection, remote checkout, abort reporting, view transitions

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope launch process statuses and logs per worktree so different worktrees of the same project show independent running state

- [#144](https://github.com/qlan-ro/mainframe/pull/144) [`6402c0e`](https://github.com/qlan-ro/mainframe/commit/6402c0e8d12ce4de231a004627e0d01655a37010) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add image attachments, filtering, and improve start-session message in todos plugin

- Updated dependencies [[`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b), [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87)]:
  - @qlan-ro/mainframe-types@0.6.0


### Minor Changes

- [#138](https://github.com/qlan-ro/mainframe/pull/138) [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add plugin action API and quick-create todo dialog (Cmd+T)

- [#144](https://github.com/qlan-ro/mainframe/pull/144) [`6402c0e`](https://github.com/qlan-ro/mainframe/commit/6402c0e8d12ce4de231a004627e0d01655a37010) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add image attachments, filtering, and improve start-session message in todos plugin

### Patch Changes

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix composer draft preservation, kill launch processes on worktree archive, add copy relative path

- [#149](https://github.com/qlan-ro/mainframe/pull/149) [`c3c97ed`](https://github.com/qlan-ro/mainframe/commit/c3c97ed495071064cf94399a1bde00922af3990d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: branch manager bugfixes — pull safety, conflict detection, remote checkout, abort reporting, view transitions

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope launch process statuses and logs per worktree so different worktrees of the same project show independent running state

- [#146](https://github.com/qlan-ro/mainframe/pull/146) [`1cae6a5`](https://github.com/qlan-ro/mainframe/commit/1cae6a5aa923e14a45f851e4df5bd932c3c9040f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace native HTML title tooltips with Radix tooltip components across the desktop app for consistent styling and behavior

- Updated dependencies [[`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b), [`511c44d`](https://github.com/qlan-ro/mainframe/commit/511c44d36cce05a9a4a8f40945b5751e7c5716f3), [`c3c97ed`](https://github.com/qlan-ro/mainframe/commit/c3c97ed495071064cf94399a1bde00922af3990d), [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b), [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87), [`6402c0e`](https://github.com/qlan-ro/mainframe/commit/6402c0e8d12ce4de231a004627e0d01655a37010)]:
  - @qlan-ro/mainframe-core@0.6.0
  - @qlan-ro/mainframe-types@0.6.0


### Minor Changes

- [#138](https://github.com/qlan-ro/mainframe/pull/138) [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add plugin action API and quick-create todo dialog (Cmd+T)

### Patch Changes

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope launch process statuses and logs per worktree so different worktrees of the same project show independent running state


## 0.5.0


### Minor Changes

- [#124](https://github.com/qlan-ro/mainframe/pull/124) [`b180a50`](https://github.com/qlan-ro/mainframe/commit/b180a500b98c16a63069e4b97c93b0c755b62e55) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Claude Agent SDK adapter as second builtin plugin alongside CLI adapter

- [#125](https://github.com/qlan-ro/mainframe/pull/125) [`97ebe7c`](https://github.com/qlan-ro/mainframe/commit/97ebe7cedb7a5f999d58795dd8378befe78f95ab) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Codex builtin adapter plugin — OpenAI Codex CLI integration via app-server JSON-RPC protocol with interactive approvals, streaming events, and session management

- [#136](https://github.com/qlan-ro/mainframe/pull/136) [`cd326c6`](https://github.com/qlan-ro/mainframe/commit/cd326c65a1d73d35379624fcc8065ded83969803) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Support ${VAR:-default} variable expansion in launch.json for environment-driven port configuration

- [#135](https://github.com/qlan-ro/mainframe/pull/135) [`5c19f6f`](https://github.com/qlan-ro/mainframe/commit/5c19f6f04de7597744ee09d32b958a6e893c1329) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: support enabling and attaching worktrees mid-session

  When a chat already has a running CLI session, enabling or attaching a worktree now stops the session, migrates CLI session files to the worktree's project directory, and respawns with --resume.

### Patch Changes

- [#123](https://github.com/qlan-ro/mainframe/pull/123) [`7d3bb30`](https://github.com/qlan-ro/mainframe/commit/7d3bb307275ed19cff61d0176074aa730dd2a569) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep WebSocket subscriptions alive for background chats so permission requests and status updates are not silently dropped when the user switches tabs. Emit chat.updated when permissions are enqueued/resolved so displayStatus correctly reflects 'waiting' state.

- [#119](https://github.com/qlan-ro/mainframe/pull/119) [`d59bafe`](https://github.com/qlan-ro/mainframe/commit/d59bafeef10fd3336060746c74ea11b24af82e7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Use the provided branch name for the worktree directory instead of a chatId prefix

- [#131](https://github.com/qlan-ro/mainframe/pull/131) [`a54c3c4`](https://github.com/qlan-ro/mainframe/commit/a54c3c4b4a89bc26949a3a10b20a50d3e2c1f0b2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: add inline session rename via PATCH endpoint and pencil button

- [#134](https://github.com/qlan-ro/mainframe/pull/134) [`851ec20`](https://github.com/qlan-ro/mainframe/commit/851ec2015077de39717c16cdd13a2cc0f1fb038d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: add todo-reader skill for querying project todos via sqlite3

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.5.0


### Patch Changes

- [#123](https://github.com/qlan-ro/mainframe/pull/123) [`7d3bb30`](https://github.com/qlan-ro/mainframe/commit/7d3bb307275ed19cff61d0176074aa730dd2a569) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep WebSocket subscriptions alive for background chats so permission requests and status updates are not silently dropped when the user switches tabs. Emit chat.updated when permissions are enqueued/resolved so displayStatus correctly reflects 'waiting' state.

- [#137](https://github.com/qlan-ro/mainframe/pull/137) [`3707218`](https://github.com/qlan-ro/mainframe/commit/37072188f8917544bba3bad9857af4829d6e9332) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Allow OAuth/SSO redirects to complete inside the sandbox webview instead of opening in the system browser. Persist webview sessions across app restarts via a dedicated Electron partition.

- [#135](https://github.com/qlan-ro/mainframe/pull/135) [`5c19f6f`](https://github.com/qlan-ro/mainframe/commit/5c19f6f04de7597744ee09d32b958a6e893c1329) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: support enabling and attaching worktrees mid-session

  When a chat already has a running CLI session, enabling or attaching a worktree now stops the session, migrates CLI session files to the worktree's project directory, and respawns with --resume.

- [#131](https://github.com/qlan-ro/mainframe/pull/131) [`a54c3c4`](https://github.com/qlan-ro/mainframe/commit/a54c3c4b4a89bc26949a3a10b20a50d3e2c1f0b2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: add inline session rename via PATCH endpoint and pencil button

- Updated dependencies [[`b180a50`](https://github.com/qlan-ro/mainframe/commit/b180a500b98c16a63069e4b97c93b0c755b62e55), [`97ebe7c`](https://github.com/qlan-ro/mainframe/commit/97ebe7cedb7a5f999d58795dd8378befe78f95ab), [`7d3bb30`](https://github.com/qlan-ro/mainframe/commit/7d3bb307275ed19cff61d0176074aa730dd2a569), [`d59bafe`](https://github.com/qlan-ro/mainframe/commit/d59bafeef10fd3336060746c74ea11b24af82e7e), [`cd326c6`](https://github.com/qlan-ro/mainframe/commit/cd326c65a1d73d35379624fcc8065ded83969803), [`5c19f6f`](https://github.com/qlan-ro/mainframe/commit/5c19f6f04de7597744ee09d32b958a6e893c1329), [`a54c3c4`](https://github.com/qlan-ro/mainframe/commit/a54c3c4b4a89bc26949a3a10b20a50d3e2c1f0b2), [`851ec20`](https://github.com/qlan-ro/mainframe/commit/851ec2015077de39717c16cdd13a2cc0f1fb038d)]:
  - @qlan-ro/mainframe-core@0.5.0
  - @qlan-ro/mainframe-types@0.5.0


## 0.2.4

### Fixes

- Fix live session diffs and context.updated timing (#100)
- Only update session updatedAt on user message send (#99)
- Prevent stale messages when switching projects (#98)
- Deduplicate display messages by id to prevent assistant-ui crash (#96)

## 0.2.3

### Features

- Branch management popover (#92)
- Add LSP proxy for Monaco editor language features (#80)
- Add Find in Path content search from file tree (#79)
- Add reveal-in-tree for open editor files (#82)
- Add Cmd+Left/Right back/forward navigation in editor (#83)
- Derive session diffs from messages, improve branch diffs (#78)
- Add pino-pretty config for dev scripts (#81)

### Fixes

- Allow image-only messages by relaxing MessageSend schema (#93)
- Auto-refresh editor when agent edits the open file (#88)
- Prevent chat message text from overflowing container (#89)
- Restore nav-history code lost in PR #82 merge (#85)
- Allow Enter to send messages while response is in progress (#76)

### Chores

- Set up Changesets for version management (#87)
- Bump the dependencies group (#84)
- Bump pnpm/action-setup from 4 to 5 (#74)
- Add WIP disclaimer and Cloudflare Tunnel guide (#77)

## 0.2.2

### Features

- Add minimize button and toggle behavior to side panels (#73)
- Auto-refresh launch config dropdown on agent writes and window focus (#72)
- Move file view collapse button to pane header with expand strip (#71)
- Move fullview plugin buttons to left rail (#70)
- Auto-refresh file tree on agent writes, window focus, and manual trigger (#69)
- Handle deleted worktrees gracefully (#65)
- Improve tool display for Claude CLI sessions (#64)
- Copy session ID on session right-click (#51)
- Open external URLs in system browser (#56)
- Mobile view toggle for sandbox preview (#49)

### Fixes

- Preserve agent label in task groups and stable session list order (#68)
- Recover chat state after project switch and restore release notes (#67)
- Recognize Agent tool and update better-sqlite3 for Electron 41 (#66)
- Resolve multiple Changes tab bugs (#63)
- Preserve selected session when switching projects (#62)
- Show AskUserQuestion Q&A as inline chat messages (#61)
- Show skill name instead of full path in session context (#60)
- Simplify permission mode management (#59)
- Recover missed responses after tab/project switch (#58)
- Coerce numeric env values to strings in launch config schema (#57)
- Allow sending messages while agent is running (#52)
- Validate cwd before spawn, dynamic CSP for Electron (#53)
- Draft releases and deduplicate changelog (#54)

### Chores

- Bump dependencies (#55, #48, #47, #46, #45)
- macOS code signing + notarization (#50)

## 0.2.1

### Fixes

- Launch env isolation, imported sessions, macOS permissions (#43)
- Dev data dir, env vars, editor save, bottom panel fixes (#42)

## 0.2.0

### Features

- Tunnel self-check verification, named tunnel switch, fd leak fix (#41)
- Import external agent sessions (#29)
- File viewing improvements + Docker fixes (#28)
- Daemon distribution — Docker, standalone binary, CLI pairing (#26)
- Mobile companion app — tunneling, permissions, launch configs (#24)
- UX improvements — CLI path, dotfiles, context menu, selection (#20)
- DisplayMessage pipeline for client-ready messages (#19)
- Full-screen overlay when daemon connection is lost (#18)
- Custom commands infrastructure (#16)
- Replace Electron file picker with daemon-side directory browser (#14)
- Playwright E2E test suite (#9)

### Fixes

- Tunnel auth bypass via localhost exemption (#40)
- Defer CLI process spawn until first message (#22)
- Tutorial flow — action-gated steps, no overlay, modal-aware (#15)
- Sandbox security, scoping, and test coverage (#17)

### Chores

- Remove Docker support (#38)
- Electron-builder publish to non-draft release (#37)
- Repair all release pipelines (#36)
- Rename packages from @mainframe/* to @qlan-ro/mainframe-* (#35)
- Publish types to GitHub Packages (#34)
- WS event router, hook split, and stale-socket fix (#13)

## 0.1.0

Initial public release.

### Features

- Multi-session management with tabbed navigation
- Claude CLI adapter with full session lifecycle (start, resume, interrupt)
- Permission gating — review and approve each tool use before execution
- Live context window usage and cost tracking
- Session history replay via Claude CLI `--resume`
- Skills support — extend agents with project-specific tools and instructions
- Agent subagent tracking (left panel Agents tab)
- Keyboard-first navigation
- Dark theme with per-adapter accent colors
