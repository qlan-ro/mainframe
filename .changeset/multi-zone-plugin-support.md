---
'@qlan-ro/mainframe-types': minor
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': patch
---

Add multi-zone plugin support — one plugin can now register multiple UI panels simultaneously.

- `PluginManifest.ui` accepts both the legacy single-object shape and a new array form; both are validated by Zod and normalized internally
- `PluginUIContext.addPanel()` now returns a stable `panelId` string for targeted removal
- `PluginUIContext.removePanel(id?)` removes a specific panel by id, or all panels for the plugin when called without an id
- Plugin layout store keys contributions by `(pluginId, panelId)` to support multiple panels per plugin
- Builtin todos plugin migrated to demonstrate multi-zone: fullview Kanban board + right-top quick-add sidebar
