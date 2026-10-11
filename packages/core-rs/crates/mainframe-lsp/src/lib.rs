//! The WS<->stdio LSP proxy.
//!
//! Re-exports: the registry (`LspRegistry`), the process
//! manager (`LspManager` + `LspServerHandle`), the connection handler
//! (`LspConnectionHandler` + `parse_lsp_upgrade_path`), and the framing bridge
//! (`bridge_ws_to_process` + `encode_json_rpc`).
#![forbid(unsafe_code)]
#![cfg_attr(
    test,
    allow(
        clippy::too_many_lines,
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "Test assertions and scenarios"
    )
)]

pub mod lsp_connection;
pub mod lsp_manager;
pub mod lsp_proxy;
pub mod lsp_registry;

pub use lsp_connection::{
    LspConnectionHandler, ReattachAction, UpgradeOutcome, cached_initialize_reply,
    capture_initialize_result, classify_reattach_first,
};
pub use lsp_manager::{ClientRef, CommandResolver, LspError, LspManager, LspServerHandle};
pub use lsp_proxy::{BridgeHandle, LspFrameParser, bridge_ws_to_process, encode_json_rpc};
pub use lsp_registry::{LspRegistry, ResolvedCommand};
