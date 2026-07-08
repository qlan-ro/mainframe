//! Ported from `src/logger.ts`.
//!
//! Scaffold parity: resolves `LOG_LEVEL` the same way `src/logger.ts` does and
//! honors `LOG_TO_STDOUT` to pick stdout vs. a daily-rotating file under
//! `$MAINFRAME_DATA_DIR/logs/`. The exact pino file-naming (`server.<date>.log`)
//! and 7-day purge are TODO(port) — `tracing_appender`'s daily roller uses its
//! own suffix scheme, close but not byte-identical to the Node output.

use std::path::PathBuf;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::EnvFilter;

/// Level names accepted by `src/logger.ts`'s `VALID_LEVELS` set.
const VALID_LEVELS: [&str; 6] = ["trace", "debug", "info", "warn", "error", "fatal"];

/// Mirrors the `rawLevel`/`VALID_LEVELS` fallback-to-`info` logic in `src/logger.ts`.
///
/// Pure by construction (takes the raw env value as an argument, rather than
/// reading `std::env` itself) so it's testable without `std::env::set_var`,
/// which edition 2024 makes `unsafe` and this workspace forbids outright.
fn resolve_level_from(raw: Option<&str>) -> String {
    let raw = raw.unwrap_or_default().trim().to_lowercase();
    // tracing has no "fatal" level; pino's "fatal" maps to tracing::Level::ERROR.
    let normalized = if raw == "fatal" {
        "error"
    } else {
        raw.as_str()
    };
    if VALID_LEVELS.contains(&raw.as_str()) {
        normalized.to_string()
    } else {
        "info".to_string()
    }
}

fn resolve_level() -> String {
    resolve_level_from(std::env::var("LOG_LEVEL").ok().as_deref())
}

/// Mirrors `logDir()` in `src/logger.ts`: `$MAINFRAME_DATA_DIR/logs`, defaulting
/// to `~/.mainframe/logs`.
fn log_dir() -> PathBuf {
    let base = std::env::var("MAINFRAME_DATA_DIR")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|home| PathBuf::from(home).join(".mainframe"))
        })
        .unwrap_or_else(|| PathBuf::from(".mainframe"));
    base.join("logs")
}

/// Initializes the global `tracing` subscriber. Safe to call once at process boot.
///
/// Returns the `WorkerGuard` for the file appender when `LOG_TO_STDOUT` is unset
/// (falsy); the caller must keep the guard alive for the process lifetime or
/// buffered log lines are lost on exit.
pub fn init() -> Option<WorkerGuard> {
    let level = resolve_level();
    let filter = EnvFilter::try_new(&level).unwrap_or_else(|_| EnvFilter::new("info"));
    let force_stdout = std::env::var("LOG_TO_STDOUT").as_deref() == Ok("true");

    if force_stdout {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(true)
            .init();
        None
    } else {
        let dir = log_dir();
        // TODO(port): mkdirSync(logDir(), {recursive:true}) + purgeOldLogs() are
        // not yet ported; tracing_appender creates the dir lazily on first write
        // but never purges files older than RETENTION_DAYS.
        let appender = tracing_appender::rolling::daily(dir, "server");
        let (non_blocking, guard) = tracing_appender::non_blocking(appender);
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(true)
            .with_writer(non_blocking)
            .with_ansi(false)
            .init();
        Some(guard)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_level_falls_back_to_info() {
        assert_eq!(resolve_level_from(None), "info");
    }

    #[test]
    fn resolve_level_accepts_valid_level() {
        assert_eq!(resolve_level_from(Some("debug")), "debug");
    }

    #[test]
    fn resolve_level_maps_fatal_to_error() {
        assert_eq!(resolve_level_from(Some("fatal")), "error");
    }

    #[test]
    fn resolve_level_rejects_unknown_level() {
        assert_eq!(resolve_level_from(Some("verbose")), "info");
    }
}

// PORT STATUS: src/logger.ts (partial)
// confidence: medium
// todos: 1
// notes: level resolution + stdout/file destination switching ported; exact
// pino file-naming, 7-day purge, and sonic-boom minLength:0 immediate-flush
// semantics are TODO(port) for the Phase 2 runtime port.
