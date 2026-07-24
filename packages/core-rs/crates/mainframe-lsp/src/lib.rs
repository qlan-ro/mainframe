//! Ported from `packages/core/src/lsp/*` — the WS<->stdio LSP proxy.
//!
//! Mirrors `index.ts`'s re-exports: the registry (`LspRegistry`), the process
//! manager (`LspManager` + `LspServerHandle`), the connection handler
//! (`LspConnectionHandler` + `parse_lsp_upgrade_path`), and the framing bridge
//! (`bridge_ws_to_process` + `encode_json_rpc`).
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod lsp_connection;
pub mod lsp_manager;
pub mod lsp_proxy;
pub mod lsp_registry;

pub use lsp_connection::{
    ChatStore, LspConnectionHandler, LspUpgradeTarget, ProjectStore, ReattachAction,
    UpgradeOutcome, cached_initialize_reply, capture_initialize_result, classify_reattach_first,
    get_effective_path, parse_lsp_upgrade_path,
};
pub use lsp_manager::{ClientRef, CommandResolver, LspError, LspManager, LspServerHandle};
pub use lsp_proxy::{BridgeHandle, LspFrameParser, bridge_ws_to_process, encode_json_rpc};
pub use lsp_registry::{LspRegistry, ResolvedCommand};

// PORT STATUS: packages/core/src/lsp/index.ts (5 lines)
// confidence: high (re-export surface)
// todos: 0
// notes: adds `ClientRef`/`CommandResolver`/`LspFrameParser`/reattach helpers to
//   the TS re-export set — Rust seams the deferred server WS layer consumes.
