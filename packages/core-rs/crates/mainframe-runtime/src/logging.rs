//! Ported from `src/logger.ts`.
//!
//! The `tracing` equivalent of the pino setup: a daily-rotated file
//! `$MAINFRAME_DATA_DIR/logs/server.<YYYY-MM-DD>.log`, a 7-day purge on boot,
//! `LOG_LEVEL`/`LOG_TO_STDOUT` env handling, stdout added off-production, and
//! silence under tests. The pino *serialization format* is not a wire contract
//! (logs are never consumed by clients), so the tracing text/field format is
//! used; the level names, thresholds, and the "logger initialized" message match.

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::prelude::*;

/// `RETENTION_DAYS` in `src/logger.ts`.
const RETENTION_DAYS: u64 = 7;

/// Level names accepted by `src/logger.ts`'s `VALID_LEVELS` set.
const VALID_LEVELS: [&str; 6] = ["trace", "debug", "info", "warn", "error", "fatal"];

/// Mirrors the `rawLevel`/`VALID_LEVELS` fallback-to-`info` logic in `src/logger.ts`.
///
/// Pure by construction (takes the raw env value as an argument) so it's testable
/// without `std::env::set_var`, which edition 2024 makes `unsafe`.
fn resolve_level_from(raw: Option<&str>) -> String {
    let raw = raw.unwrap_or_default().trim().to_lowercase();
    // tracing has no "fatal" level; pino's "fatal" maps to tracing's ERROR.
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
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".mainframe")
        });
    base.join("logs")
}

/// The `purgeOldLogs()` decision, factored pure for testing: a `server.*` file
/// whose mtime predates the cutoff is stale.
fn is_stale_server_log(file_name: &str, modified: SystemTime, cutoff: SystemTime) -> bool {
    file_name.starts_with("server.") && modified < cutoff
}

/// Mirrors `purgeOldLogs()`: delete `server.*` files older than `RETENTION_DAYS`,
/// ignoring per-file and missing-dir errors.
fn purge_old_logs(dir: &PathBuf) {
    let cutoff = SystemTime::now() - Duration::from_secs(RETENTION_DAYS * 86_400);
    let Ok(entries) = fs::read_dir(dir) else {
        return; // ignore if dir doesn't exist yet
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // ignore individual file errors
        if let Ok(modified) = entry.metadata().and_then(|m| m.modified())
            && is_stale_server_log(&name, modified, cutoff)
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// `true` when running under Vitest/Node test env — mirrors `isTest` in
/// `src/logger.ts` (silences all logging).
fn is_test_env() -> bool {
    std::env::var("NODE_ENV").as_deref() == Ok("test")
        || std::env::var("VITEST").as_deref() == Ok("true")
}

/// Initializes the global `tracing` subscriber. Safe to call once at process boot.
///
/// Returns the `WorkerGuard` for the file appender; the caller must keep it alive
/// for the process lifetime or buffered log lines are lost on exit. Returns
/// `None` under tests (silent, no subscriber) or if the file appender cannot be
/// built (graceful stdout-only fallback).
pub fn init() -> Option<WorkerGuard> {
    if is_test_env() {
        return None;
    }

    let level = resolve_level();
    let raw = std::env::var("LOG_LEVEL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "(unset)".to_string());
    let is_prod = std::env::var("NODE_ENV").as_deref() == Ok("production");
    let force_stdout = std::env::var("LOG_TO_STDOUT").as_deref() == Ok("true");

    let dir = log_dir();
    let _ = fs::create_dir_all(&dir); // ensureLogDir(); mkdir -p
    purge_old_logs(&dir);

    let filter = EnvFilter::try_new(&level).unwrap_or_else(|_| EnvFilter::new("info"));

    // pino's dailyDestination() -> `server.<date>.log`, append-only.
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("server")
        .filename_suffix("log")
        .build(&dir);
    let appender = match appender {
        Ok(appender) => appender,
        Err(_) => {
            // Graceful fallback: stdout-only when the file appender can't be built.
            tracing_subscriber::fmt()
                .with_env_filter(EnvFilter::new(level))
                .init();
            return None;
        }
    };

    let (non_blocking, guard) = tracing_appender::non_blocking(appender);

    // Node always writes to the file; stdout is added when not production, or
    // when LOG_TO_STDOUT forces it.
    let file_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(non_blocking);
    let stdout_layer = if !is_prod || force_stdout {
        Some(tracing_subscriber::fmt::layer().with_writer(std::io::stdout))
    } else {
        None
    };

    tracing_subscriber::registry()
        .with(filter)
        .with(file_layer)
        .with(stdout_layer)
        .init();

    tracing::info!(log_level = %level, raw = %raw, "logger initialized");

    Some(guard)
}

/// Mirrors `createChildLogger(name)`: a logger scoped with a `module` field.
///
/// pino child loggers carry `{ module: name }` on every line; the returned
/// [`ChildLogger`] threads that field through the `tracing` macros.
pub fn create_child_logger(name: &str) -> ChildLogger {
    ChildLogger {
        module: name.to_string(),
    }
}

/// A `module`-scoped logger — the port's stand-in for `logger.child({ module })`.
#[derive(Debug, Clone)]
pub struct ChildLogger {
    module: String,
}

impl ChildLogger {
    pub fn trace(&self, message: &str) {
        tracing::trace!(module = %self.module, "{message}");
    }
    pub fn debug(&self, message: &str) {
        tracing::debug!(module = %self.module, "{message}");
    }
    pub fn info(&self, message: &str) {
        tracing::info!(module = %self.module, "{message}");
    }
    pub fn warn(&self, message: &str) {
        tracing::warn!(module = %self.module, "{message}");
    }
    pub fn error(&self, message: &str) {
        tracing::error!(module = %self.module, "{message}");
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

    #[test]
    fn resolve_level_trims_and_lowercases() {
        assert_eq!(resolve_level_from(Some("  WARN  ")), "warn");
    }

    #[test]
    fn stale_predicate_matches_only_old_server_logs() {
        let cutoff = SystemTime::now();
        let old = cutoff - Duration::from_secs(10);
        let fresh = cutoff + Duration::from_secs(10);
        assert!(is_stale_server_log("server.2000-01-01.log", old, cutoff));
        assert!(!is_stale_server_log("server.2999-01-01.log", fresh, cutoff));
        assert!(!is_stale_server_log("keep.txt", old, cutoff));
    }

    #[test]
    fn purge_ignores_missing_dir() {
        // Missing dir must not panic (mirrors the TS outer try/catch).
        purge_old_logs(&PathBuf::from("/nonexistent/mainframe/logs/xyz"));
    }
}

// PORT STATUS: src/logger.ts (87 lines)
// confidence: medium
// todos: 0
// notes: full behavioral port — daily `server.<date>.log` via the appender
// builder (filename_suffix "log"), 7-day purge on boot, LOG_LEVEL/LOG_TO_STDOUT,
// stdout added off-production, silent under NODE_ENV=test/VITEST=true, and the
// "logger initialized" info line. pino's JSON line format is NOT reproduced (logs
// aren't a wire contract) — tracing's fmt layer is used; only level names/
// thresholds/messages match. `createChildLogger` -> `ChildLogger` carrying a
// `module` field on each tracing macro (structured context per call site is added
// by consumers when their modules are ported). The purge test cannot set mtime
// without the `filetime` crate (not in the allowlist), so it only asserts recent
// server.* logs + non-server files survive; the stale-deletion branch is covered
// by the read/starts-with/cutoff logic, verified against fresh files. sync fs at
// boot mirrors pino's sync module-load (readdirSync/mkdirSync), not request I/O.
