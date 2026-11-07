//! Daemon logging setup: a daily-rotated file
//! `<configured dataDir>/logs/server.<YYYY-MM-DD>.log`, a 7-day purge on boot,
//! `LOG_LEVEL`/`LOG_TO_STDOUT` env handling, stdout added off-production, and
//! silence under tests. The log line format is not a wire contract (logs are
//! never consumed by clients), so the tracing text/field format is used.

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::prelude::*;

/// Days a `server.*` log file is kept before the boot purge deletes it.
const RETENTION_DAYS: u64 = 7;

/// Resolves a raw `LOG_LEVEL` value, falling back to `info` for anything else.
/// Takes the value as an argument so tests need no `std::env::set_var`.
fn resolve_level_from(raw: Option<&str>) -> &'static str {
    match raw.unwrap_or_default().trim().to_lowercase().as_str() {
        "trace" => "trace",
        "debug" => "debug",
        "warn" => "warn",
        // tracing has no "fatal" level.
        "error" | "fatal" => "error",
        _ => "info",
    }
}

fn resolve_level() -> &'static str {
    resolve_level_from(std::env::var("LOG_LEVEL").ok().as_deref())
}

/// The `purge_old_logs` decision, factored pure for testing: a `server.*` file
/// whose mtime predates the cutoff is stale.
fn is_stale_server_log(file_name: &str, modified: SystemTime, cutoff: SystemTime) -> bool {
    file_name.starts_with("server.") && modified < cutoff
}

/// Deletes `server.*` files older than `RETENTION_DAYS`,
/// ignoring per-file and missing-dir errors.
fn purge_old_logs(dir: &Path) {
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
            let _ = fs::remove_file(entry.path()); /* expected */ // Boot purge tolerates inaccessible logs.
        }
    }
}

/// `true` when `NODE_ENV=test` or `VITEST=true` is set (silences all logging).
fn is_test_env() -> bool {
    std::env::var("NODE_ENV").as_deref() == Ok("test")
        || std::env::var("VITEST").as_deref() == Ok("true")
}

/// Initializes the global `tracing` subscriber, writing into `log_dir` (resolved
/// by [`crate::config::boot_paths`]). Safe to call once at process boot.
///
/// Returns the `WorkerGuard` for the file appender; the caller must keep it alive
/// for the process lifetime or buffered log lines are lost on exit. Returns
/// `None` under tests (silent, no subscriber) or if the file appender cannot be
/// built (graceful stdout-only fallback).
pub fn init(log_dir: &Path) -> Option<WorkerGuard> {
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

    if let Err(err) = fs::create_dir_all(log_dir) {
        boot_error(
            &format!("could not create log directory {}", log_dir.display()),
            &err,
        );
    }
    purge_old_logs(log_dir);

    // Daily `server.<date>.log` files, append-only.
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("server")
        .filename_suffix("log")
        .build(log_dir);
    let appender = match appender {
        Ok(appender) => appender,
        Err(error) => {
            tracing_subscriber::fmt()
                .with_env_filter(EnvFilter::new(level))
                .init();
            tracing::warn!(%error, "file logging unavailable, using stdout only");
            return None;
        }
    };

    let (non_blocking, guard) = tracing_appender::non_blocking(appender);

    // Always write to the file; stdout is added when not production, or
    // when LOG_TO_STDOUT forces it.
    let file_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(non_blocking);
    let stdout_layer = (!is_prod || force_stdout)
        .then(|| tracing_subscriber::fmt::layer().with_writer(std::io::stdout));

    tracing_subscriber::registry()
        .with(EnvFilter::new(level))
        .with(file_layer)
        .with(stdout_layer)
        .init();

    tracing::info!(log_level = %level, raw = %raw, "logger initialized");

    Some(guard)
}

pub fn boot_error(context: &str, error: &dyn std::fmt::Display) {
    let subscriber = tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .finish();
    tracing::subscriber::with_default(subscriber, || {
        tracing::error!(%error, "{context}");
    });
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
        // Missing dir must not panic.
        purge_old_logs(Path::new("/nonexistent/mainframe/logs/xyz"));
    }
}
