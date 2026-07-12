//! Loads the three builtin plugins into the `PluginManager`, mirroring the three
//! `pluginManager.loadBuiltin(...)` calls in `index.ts` (claude, codex, todos).
//!
//! In the TS daemon the claude/codex `activate` register their adapter into the
//! shared `AdapterRegistry`. In the Rust port the adapters are registered directly
//! on the `AdapterRegistry` at boot (see `main`), so their plugin `activate` is a
//! no-op that only publishes the manifest for the `/api/plugins` listing — the
//! PLUGIN identity/manifest surface still matches `GET /api/plugins`. The `todos`
//! plugin owns the real builtin router + storage, so it loads its ported `activate`.
//!
//! The manifests are verbatim copies of the TS `manifest.json` files (which live in
//! the READ-ONLY TS package and cannot be `include_str!`'d across crates).

use std::path::Path;

use axum::Router;
use mainframe_plugins::{PluginError, PluginManager};
use mainframe_types::plugin::PluginManifest;

/// `src/plugins/builtin/claude/manifest.json`.
const CLAUDE_MANIFEST: &str = r#"{
  "id": "claude",
  "name": "Claude Code",
  "version": "1.0.0",
  "description": "Claude Code adapter — built-in",
  "capabilities": ["adapters", "process:exec"],
  "adapter": {
    "binaryName": "claude",
    "displayName": "Claude Code"
  },
  "commands": [
    { "name": "clear", "description": "Clear conversation history" },
    { "name": "compact", "description": "Compress context to save tokens" }
  ]
}"#;

/// `src/plugins/builtin/codex/manifest.json`.
const CODEX_MANIFEST: &str = r#"{
  "id": "codex",
  "name": "Codex",
  "version": "1.0.0",
  "description": "OpenAI Codex adapter via app-server protocol",
  "capabilities": ["adapters", "process:exec"],
  "adapter": {
    "binaryName": "codex",
    "displayName": "Codex"
  }
}"#;

/// `src/plugins/builtin/todos/manifest.json`.
const TODOS_MANIFEST: &str = r#"{
  "id": "todos",
  "name": "TODO Kanban",
  "version": "1.0.0",
  "description": "GitHub-style kanban board for tracking tasks",
  "author": "Mainframe Team",
  "capabilities": ["storage", "chat:create", "ui:panels", "ui:notifications"],
  "ui": {
    "zone": "fullview",
    "label": "Tasks",
    "icon": "square-check"
  }
}"#;

/// Load claude, codex, then todos — the same order + set as `index.ts`. Duplicate
/// ids are a no-op (matches `loadBuiltin`'s early return).
pub async fn load_builtin_plugins(
    plugin_manager: &PluginManager,
    data_dir: &Path,
) -> Result<(), PluginError> {
    let plugins_dir = data_dir.join("plugins");

    // claude/codex: adapter already registered on the AdapterRegistry — the plugin
    // load only publishes the manifest for the listing (activate is a no-op).
    let claude: PluginManifest = serde_json::from_str(CLAUDE_MANIFEST)?;
    plugin_manager
        .load_builtin(claude, plugins_dir.join("claude"), noop_activate)
        .await?;

    let codex: PluginManifest = serde_json::from_str(CODEX_MANIFEST)?;
    plugin_manager
        .load_builtin(codex, plugins_dir.join("codex"), noop_activate)
        .await?;

    // todos: real builtin router + storage — its data.db lives under the plugin dir.
    let todos_dir = plugins_dir.join("todos");
    tokio::fs::create_dir_all(&todos_dir).await?; // mkdirSync(todosPluginDir)
    let todos: PluginManifest = serde_json::from_str(TODOS_MANIFEST)?;
    plugin_manager
        .load_builtin(todos, todos_dir, mainframe_plugins::todos::activate)
        .await?;

    Ok(())
}

/// The claude/codex `activate`: adapter registration already happened on the
/// AdapterRegistry, so this contributes no HTTP routes.
async fn noop_activate(
    _ctx: std::sync::Arc<mainframe_plugins::PluginContext>,
) -> Result<Router<()>, PluginError> {
    Ok(Router::new())
}

// PORT STATUS: src/index.ts (the three loadBuiltin calls) + builtin manifests
// confidence: medium
// todos: 0
// notes: claude/codex/todos loaded in index.ts order. claude/codex activate is a
// no-op (adapter registered directly on the AdapterRegistry in main — reconciles the
// "adapters stay on the AdapterRegistry" decision with the GET /api/plugins listing
// expectation). todos loads its ported activate + gets its storage dir created
// (mkdirSync parity). Manifests are verbatim copies of the TS manifest.json (no
// cross-crate include_str! for the READ-ONLY TS source).
