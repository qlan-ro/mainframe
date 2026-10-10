//! The WS<->stdio LSP proxy.
//!
//! Re-exports: the registry (`LspRegistry`), the process
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
    ChatStore, LspConnectionHandler, ProjectStore, ReattachAction, UpgradeOutcome,
    cached_initialize_reply, capture_initialize_result, classify_reattach_first,
    get_effective_path,
};
pub use lsp_manager::{ClientRef, CommandResolver, LspError, LspManager, LspServerHandle};
pub use lsp_proxy::{BridgeHandle, LspFrameParser, bridge_ws_to_process, encode_json_rpc};
pub use lsp_registry::{LspRegistry, ResolvedCommand};
