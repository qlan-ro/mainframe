fn is_rfc3339_prefix(ts: &str) -> bool {
    let b = ts.as_bytes();
    // yyyy-mm-ddT + at least one time char + Z
    b.len() > 12
        && b.ends_with(b"Z")
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[7] == b'-'
        && b[8..10].iter().all(u8::is_ascii_digit)
        && b[10] == b'T'
        && b[11..b.len() - 1]
            .iter()
            .all(|c| c.is_ascii_digit() || *c == b':' || *c == b'.')
}

/// `<rfc3339> <LEVEL> <target>: <message>` — the codex binary's tracing format.
/// Hand-rolled (no regex crate); requires something to follow the level.
pub(super) fn is_tracing_line(message: &str) -> bool {
    let mut parts = message.split_whitespace();
    let Some(ts) = parts.next() else {
        return false;
    };
    if !is_rfc3339_prefix(ts) {
        return false;
    }
    if !matches!(
        parts.next(),
        Some("TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR")
    ) {
        return false;
    }
    parts.next().is_some()
}

/// The app-server discards panicked task handles and can still exit 0, so a panic is only
/// detectable on stderr. Latched during the run and reported at exit, never mid-run.
pub(super) fn is_panic_line(message: &str) -> bool {
    message.starts_with("thread '") && message.contains("panicked")
}

#[cfg(test)]
mod stderr_tests {
    use super::{is_panic_line, is_tracing_line};

    #[test]
    fn latches_a_rust_panic_line() {
        assert!(is_panic_line(
            "thread 'tokio-runtime-worker' panicked at src/foo.rs:1:1"
        ));
        // The #237 line is an ordinary tracing ERROR, not a panic — it must NOT latch.
        assert!(!is_panic_line(
            "2026-07-13T13:10:39.248771Z ERROR rmcp::transport::worker: worker quit with fatal: \
             Transport channel closed, when AuthRequired(AuthRequiredError { .. })"
        ));
        assert!(!is_panic_line("all good here"));
    }

    #[test]
    fn rejects_timestamp_shaped_garbage() {
        assert!(!is_tracing_line("2TgarbageZ ERROR foo: bar"));
        assert!(!is_tracing_line("2026-07-13T13:10:39.248771Z ERROR"));
    }

    // The #237 repro: an unauthenticated remote MCP server makes codex log this on every
    // startup while the run itself proceeds fine.
    #[test]
    fn classifies_the_rmcp_auth_required_error_as_a_tracing_line() {
        assert!(is_tracing_line(
            "2026-07-13T13:10:39.248771Z ERROR rmcp::transport::worker: worker quit with fatal: \
             Transport channel closed, when AuthRequired(AuthRequiredError { .. })"
        ));
    }

    #[test]
    fn classifies_every_tracing_level() {
        for level in ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"] {
            assert!(is_tracing_line(&format!(
                "2026-07-13T13:10:39.248771Z {level} codex_core::config: loaded"
            )));
        }
    }

    #[test]
    fn rejects_lines_that_are_not_tracing_output() {
        assert!(!is_tracing_line(
            "thread 'main' panicked at src/main.rs:1:1"
        ));
        assert!(!is_tracing_line("error: unexpected argument '--nope'"));
        assert!(!is_tracing_line(""));
        assert!(!is_tracing_line("2026-07-13T13:10:39.248771Z"));
        assert!(!is_tracing_line("ERROR rmcp: no leading timestamp"));
    }
}
