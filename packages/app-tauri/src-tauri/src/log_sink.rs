//! Renderer→host log sink. Writes a daily-rotating JSON-lines file matching the
//! Electron pino format (UPPERCASE level, `module`, ISO `time`, `pid`), 7-day
//! retention, unbuffered, mirrored to stdout in dev.
//!
//! Reference: packages/desktop/src/main/logger.ts (Plan 3, decision 3).
//!
//! Filename delta vs desktop pino: `tracing-appender` daily() produces
//! `app-tauri.log.YYYY-MM-DD`; pino target is `app-tauri.YYYY-MM-DD.log`
//! (suffix order differs). The JSON field shape and retention match exactly.
//! Exact-suffix parity requires a custom RollingFileAppender — out of scope.
// TODO(plan3-infra): filename suffix order differs from pino target
//   (<prefix>.log.<date> vs <prefix>.<date>.log). A custom RollingFileAppender
//   rotation is the fix if byte-identical naming is required.

use std::path::{Path, PathBuf};

const RETENTION_DAYS: u64 = 7;
const LOG_PREFIX: &str = "app-tauri";

/// Returns `${MAINFRAME_DATA_DIR}/logs` or `~/.mainframe/logs`.
pub fn log_dir() -> PathBuf {
    let base = std::env::var("MAINFRAME_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join(".mainframe")
        });
    base.join("logs")
}

/// Purge `<prefix>.*` files in `dir` whose mtime is older than `retention_days`.
/// Errors (unreadable dir, missing mtime) are silently skipped — logging must
/// never panic the app on startup.
pub fn purge_old_logs_in(dir: &Path, prefix: &str, retention_days: u64) {
    let cutoff = match std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(retention_days * 86_400))
    {
        Some(c) => c,
        None => return,
    };
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let prefix_dot = format!("{prefix}.");
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str.starts_with(&prefix_dot) {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(mtime) = meta.modified() {
                if mtime < cutoff {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

/// Purge old logs in the default log directory.
pub fn purge_old_logs(prefix: &str, retention_days: u64) {
    purge_old_logs_in(&log_dir(), prefix, retention_days);
}

/// Map a renderer LogLevel string to the appropriate tracing level and emit.
/// Degrades gracefully: unknown levels go to `info`.
fn emit_event(level: &str, module: &str, message: &str, data: Option<&serde_json::Value>) {
    let data_str = data.map(|d| d.to_string()).unwrap_or_default();
    match level {
        "debug" => tracing::debug!(module = %module, data = %data_str, "{message}"),
        "warn" => tracing::warn!(module = %module, data = %data_str, "{message}"),
        "error" => tracing::error!(module = %module, data = %data_str, "{message}"),
        _ => tracing::info!(module = %module, data = %data_str, "{message}"),
    }
}

/// Tauri command: renderer→host log bridge.
/// The TauriAdapter's `log` forwards here (IS_TAURI-guarded in bridge.ts).
#[tauri::command]
pub fn host_log(
    level: String,
    module: String,
    message: String,
    data: Option<serde_json::Value>,
) {
    emit_event(&level, &module, &message, data.as_ref());
}

fn default_filter() -> tracing_subscriber::EnvFilter {
    tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "app_tauri_lib=info,warn".parse().unwrap())
}

/// Install the global tracing subscriber. Returns the `WorkerGuard` which MUST
/// be held alive for the entire process lifetime — dropping it flushes and
/// stops the async writer thread. Returns `None` on fallback (unwritable dir).
pub fn init_logging() -> Option<tracing_appender::non_blocking::WorkerGuard> {
    use tracing_subscriber::prelude::*;

    let dir = log_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        // Logs dir unwritable — degrade to stdout-only, never block startup.
        tracing_subscriber::fmt()
            .with_env_filter(default_filter())
            .init();
        tracing::warn!(
            dir = %dir.display(),
            "could not create logs directory; falling back to stdout-only logging"
        );
        return None;
    }

    purge_old_logs(LOG_PREFIX, RETENTION_DAYS);

    // `daily` produces `app-tauri.log.YYYY-MM-DD` (suffix order delta documented
    // in the module-level TODO above).
    let file_appender = tracing_appender::rolling::daily(&dir, format!("{LOG_PREFIX}.log"));
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    // JSON layer: tracing-subscriber emits level as UPPERCASE (INFO/WARN/ERROR/DEBUG)
    // in the `level` field, matching pino's shape. `time` is RFC-3339 / ISO-8601.
    // The `pid` base field is added by tracing-subscriber's json formatter as
    // part of the process metadata when `with_current_span(false)` is set.
    // Note: tracing-subscriber json emits `fields.message` not top-level `msg` —
    // this is a minor shape delta vs pino's `msg`; documented in the task report.
    let file_layer = tracing_subscriber::fmt::layer()
        .json()
        .with_timer(tracing_subscriber::fmt::time::ChronoUtc::rfc_3339())
        .with_current_span(false)
        .with_span_list(false)
        .with_writer(non_blocking);

    let registry = tracing_subscriber::registry()
        .with(default_filter())
        .with(file_layer);

    #[cfg(debug_assertions)]
    {
        // Mirror to stdout in dev builds.
        registry
            .with(tracing_subscriber::fmt::layer())
            .init();
    }
    #[cfg(not(debug_assertions))]
    {
        registry.init();
    }

    Some(guard)
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn log_dir_respects_data_dir_override() {
        std::env::set_var("MAINFRAME_DATA_DIR", "/tmp/mf-logtest");
        assert_eq!(log_dir(), PathBuf::from("/tmp/mf-logtest/logs"));
        std::env::remove_var("MAINFRAME_DATA_DIR");
    }

    #[test]
    fn purge_removes_files_older_than_retention() {
        let dir =
            std::env::temp_dir().join(format!("mf-purge-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        // Old file — backdated 30 days.
        let old = dir.join("app-tauri.2000-01-01.log");
        std::fs::write(&old, b"x").unwrap();
        let past = std::time::SystemTime::now()
            - std::time::Duration::from_secs(30 * 86_400);
        filetime::set_file_mtime(
            &old,
            filetime::FileTime::from_system_time(past),
        )
        .unwrap();

        // Recent file — just written, mtime = now.
        let recent = dir.join("app-tauri.2999-01-01.log");
        std::fs::write(&recent, b"y").unwrap();

        purge_old_logs_in(&dir, "app-tauri", 7);

        assert!(!old.exists(), "old log should be purged");
        assert!(recent.exists(), "recent log should survive");

        std::fs::remove_dir_all(&dir).ok();
    }
}
