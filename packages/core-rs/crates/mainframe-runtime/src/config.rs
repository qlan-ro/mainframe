//! Ported from `src/config.ts`.
//!
//! Only the pieces needed to boot the health-only scaffold are ported so far:
//! the `DAEMON_PORT` env override. `dataDir`/tunnel/auth-secret config and the
//! `config.json` load/persist path are not yet ported.

/// Default daemon HTTP/WS port, matching `DEFAULT_CONFIG.port` in `src/config.ts`.
pub const DEFAULT_PORT: u16 = 31415;

/// Mirrors the `DAEMON_PORT` branch of `envOverrides()` in `src/config.ts`:
/// only a finite, positive value overrides the default.
///
/// Pure by construction (takes the raw env value as an argument, rather than
/// reading `std::env` itself) so it's testable without `std::env::set_var`,
/// which edition 2024 makes `unsafe` and this workspace forbids outright.
pub fn resolve_port_from(raw: Option<&str>) -> u16 {
    match raw {
        Some(raw) => raw
            .trim()
            .parse::<u16>()
            .ok()
            .filter(|port| *port > 0)
            .unwrap_or(DEFAULT_PORT),
        None => DEFAULT_PORT,
    }
}

/// Reads `DAEMON_PORT` from the process environment and resolves it via
/// [`resolve_port_from`].
pub fn resolve_port() -> u16 {
    resolve_port_from(std::env::var("DAEMON_PORT").ok().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_port_defaults_when_unset() {
        assert_eq!(resolve_port_from(None), DEFAULT_PORT);
    }

    #[test]
    fn resolve_port_honors_valid_override() {
        assert_eq!(resolve_port_from(Some("31500")), 31500);
    }

    #[test]
    fn resolve_port_falls_back_on_invalid_value() {
        assert_eq!(resolve_port_from(Some("not-a-port")), DEFAULT_PORT);
    }

    #[test]
    fn resolve_port_falls_back_on_zero() {
        assert_eq!(resolve_port_from(Some("0")), DEFAULT_PORT);
    }
}

// PORT STATUS: src/config.ts (partial — DAEMON_PORT env override only)
// confidence: medium
// todos: 1
// notes: dataDir/tunnel/authSecret fields, config.json load/persist, and the
// remaining env overrides (MAINFRAME_DATA_DIR, TUNNEL, TUNNEL_URL, TUNNEL_TOKEN)
// are TODO(port) — deferred to the Phase 2 runtime port.
