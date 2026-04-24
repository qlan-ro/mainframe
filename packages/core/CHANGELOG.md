# @qlan-ro/mainframe-core

## 0.14.0

### Minor Changes

- [#245](https://github.com/qlan-ro/mainframe/pull/245) [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add multi-zone plugin support — one plugin can now register multiple UI panels simultaneously.
  - `PluginManifest.ui` accepts both the legacy single-object shape and a new array form; both are validated by Zod and normalized internally
  - `PluginUIContext.addPanel()` now returns a stable `panelId` string for targeted removal
  - `PluginUIContext.removePanel(id?)` removes a specific panel by id, or all panels for the plugin when called without an id
  - Plugin layout store keys contributions by `(pluginId, panelId)` to support multiple panels per plugin
  - Builtin todos plugin migrated to demonstrate multi-zone: fullview Kanban board + right-top quick-add sidebar

### Patch Changes

- [#243](https://github.com/qlan-ro/mainframe/pull/243) [`1367009`](https://github.com/qlan-ro/mainframe/commit/1367009dbc2c676bef18ff2ce13c087d19a99e95) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make `asyncHandler` return its wrapped Promise so tests can properly `await` route handlers. Previously the wrapper used a fire-and-forget `.catch(next)` which discarded the Promise, forcing tests to rely on a 50ms `setTimeout`-based polyfill that raced against `listFilesWithRipgrep`'s subprocess spawn and flaked under load. Server behavior is unchanged (Express ignores the handler's return value).

- [#247](https://github.com/qlan-ro/mainframe/pull/247) [`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace skill-injection grey bubble with a collapsible SkillLoadedCard
  - Add `skill_loaded` content block type to `MessageContent` and `DisplayContent`
  - Add `onSkillLoaded` to `SessionSink`; parse skill name, path, and content from the CLI-injected user-event text (`<skill-format>true</skill-format>`)
  - Suppress `onCliMessage` for skill-injection text; emit `onSkillLoaded` + `onSkillFile` instead
  - Cache the authoritative path extracted from the text so the `Skill` tool_use branch reuses it
  - Wire `onSkillLoaded` through `event-handler.ts` as a transient system message with a `skill_loaded` block
  - Pass `skill_loaded` blocks through `display-pipeline.ts` and `convert-message.ts` via message metadata
  - Render skill messages as a `SkillLoadedCard` (collapsible, `defaultOpen={false}`) in `SystemMessage.tsx`
  - New `SkillLoadedCard.tsx`: Zap icon + `/skillName` header with path tooltip; markdown body inside `max-h-[480px]` scrollable pane
  - Preserve user-typed `/skill-name` (and `/skill-name args`) bubbles: display-pipeline now synthesizes a readable `/cmd args` bubble from the CLI's `<command-name>`/`<command-args>` echo instead of dropping the entry

- Updated dependencies [[`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b), [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf)]:
  - @qlan-ro/mainframe-types@0.14.0
