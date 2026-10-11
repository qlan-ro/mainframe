//! Why a tunnel start failed. The text is broadcast as the tunnel's error
//! status and returned by the tunnel routes verbatim, so it is wire contract.

use std::sync::Arc;

/// A failed `TunnelManager::start` or `PortTunnelRegistry::start`. Clone so
/// every waiter joining an in-flight start sees the same outcome.
#[derive(Debug, Clone, thiserror::Error)]
pub enum TunnelStartError {
    #[error("Daemon is shutting down")]
    ShuttingDown,
    #[error(
        "cloudflared not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    )]
    CloudflaredMissing,
    #[error(transparent)]
    Spawn(Arc<std::io::Error>),
    #[error("Tunnel \"{label}\" timed out after {ms}ms")]
    Timeout { label: String, ms: u128 },
    /// `code` is the exit code, or `null` for a signal.
    #[error("Tunnel \"{label}\" process exited before ready (code {code})")]
    ExitedEarly { label: String, code: String },
    #[error("Tunnel start cancelled")]
    Cancelled,
    /// The start the caller joined ended without publishing an outcome.
    #[error("Tunnel start abandoned")]
    Abandoned,
}

impl TunnelStartError {
    pub(crate) fn spawn(error: std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::NotFound {
            Self::CloudflaredMissing
        } else {
            Self::Spawn(Arc::new(error))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texts_are_the_broadcast_and_route_strings() {
        let cases = [
            (TunnelStartError::ShuttingDown, "Daemon is shutting down"),
            (
                TunnelStartError::spawn(std::io::Error::from(std::io::ErrorKind::NotFound)),
                "cloudflared not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
            ),
            (
                TunnelStartError::spawn(std::io::Error::other("EACCES")),
                "EACCES",
            ),
            (
                TunnelStartError::Timeout {
                    label: "daemon".into(),
                    ms: 15_000,
                },
                "Tunnel \"daemon\" timed out after 15000ms",
            ),
            (
                TunnelStartError::ExitedEarly {
                    label: "daemon".into(),
                    code: "null".into(),
                },
                "Tunnel \"daemon\" process exited before ready (code null)",
            ),
            (TunnelStartError::Cancelled, "Tunnel start cancelled"),
            (TunnelStartError::Abandoned, "Tunnel start abandoned"),
        ];
        for (error, text) in cases {
            assert_eq!(error.to_string(), text);
        }
    }
}
