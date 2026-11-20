//! Language servers behind the editor's `/lsp/{projectId}/{language}`
//! WebSocket: command discovery ([`LspRegistry`]), one child per
//! `(projectId, language)` with an idle reaper and a graceful shutdown
//! ([`LspManager`]), and editor sessions over a running child ([`LspClient`]).
//! The server crate owns the socket and pumps it through an [`LspClient`].
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

mod client;
mod framing;
mod manager;
mod registry;
#[cfg(test)]
mod test_fixtures;

pub use client::{ClientEvent, LspClient};
pub use manager::{LspError, LspManager, LspServerHandle};
pub use registry::LspRegistry;
