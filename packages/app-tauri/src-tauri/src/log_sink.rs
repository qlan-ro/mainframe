//! Renderer→host log sink. Writes a daily-rotating JSON-lines file matching the
//! desktop pino format exactly: top-level `level` (UPPERCASE), `time` (ISO),
//! `pid`, `module`, `msg`; optional top-level `data` only when present.
//!
//! Reference: packages/desktop/src/main/logger.ts (Plan 3, decision 3).
//!
//! A custom `PinoFormat` impl (rather than `.json()`) is required to emit the
//! exact key names and placement pino uses, since tracing-subscriber's built-in
//! JSON formatter puts the message under `fields.message` and timestamps under
//! `timestamp` with no `pid`.

use std::fmt;
use std::path::{Path, PathBuf};

use serde_json::json;
use tracing::Event;
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::registry::LookupSpan;

const RETENTION_DAYS: u64 = 7;
const LOG_PREFIX: &str = "app-tauri";

// ── Pino-exact JSON formatter ─────────────────────────────────────────────────

/// Formats each tracing event as one JSON line with exactly the keys pino emits:
/// `level` (UPPERCASE), `time` (ISO-8601 UTC), `pid`, `module`, `msg`, and
/// optionally `data` (only when present in the event fields).
struct PinoFormat;

/// Visitor that extracts `module`, `msg`, and optionally `data` from the event
/// fields without allocating unless needed.
struct FieldVisitor {
    module: Option<String>,
    msg: Option<String>,
    data: Option<String>,
}

impl FieldVisitor {
    fn new() -> Self {
        Self {
            module: None,
            msg: None,
            data: None,
        }
    }
}

impl tracing::field::Visit for FieldVisitor {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        match field.name() {
            "module" => self.module = Some(value.to_owned()),
            "message" => self.msg = Some(value.to_owned()),
            "data" => {
                if !value.is_empty() {
                    self.data = Some(value.to_owned());
                }
            }
            _ => {}
        }
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn fmt::Debug) {
        // `message` is sometimes delivered as debug (e.g. tracing::info!("text"))
        match field.name() {
            "message" => self.msg = Some(format!("{value:?}")),
            "module" => self.module = Some(format!("{value:?}")),
            "data" => {
                let s = format!("{value:?}");
                if !s.is_empty() {
                    self.data = Some(s);
                }
            }
            _ => {}
        }
    }
}

impl<S, N> FormatEvent<S, N> for PinoFormat
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        _ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        // Collect fields from the event.
        let mut visitor = FieldVisitor::new();
        event.record(&mut visitor);

        // ISO-8601 UTC timestamp matching pino's `isoTime` serializer.
        let time = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

        // Level as UPPERCASE string.
        let level = event.metadata().level().as_str().to_uppercase();

        let pid = std::process::id();

        // module falls back to the tracing target if not set in fields.
        let module = visitor
            .module
            .unwrap_or_else(|| event.metadata().target().to_owned());

        let msg = visitor.msg.unwrap_or_default();

        // Build the JSON object — include `data` only when present.
        let mut obj = serde_json::Map::new();
        obj.insert("level".into(), json!(level));
        obj.insert("time".into(), json!(time));
        obj.insert("pid".into(), json!(pid));
        obj.insert("module".into(), json!(module));
        obj.insert("msg".into(), json!(msg));
        if let Some(data) = visitor.data {
            obj.insert("data".into(), json!(data));
        }

        // Serialize; on a (theoretically impossible) serialization error, fall
        // back to a minimal safe line rather than panicking.
        let line = serde_json::to_string(&serde_json::Value::Object(obj))
            .unwrap_or_else(|_| r#"{"level":"ERROR","msg":"log serialization failed"}"#.into());

        // `fmt::Write` trait — the writer is a `&mut dyn fmt::Write`.
        write!(writer, "{}\n", line)
    }
}

// ── Log directory ─────────────────────────────────────────────────────────────

/// Returns `${MAINFRAME_DATA_DIR}/logs` or `~/.mainframe/logs`.
///
/// Takes the optional override as a parameter so this pure function can be
/// tested without touching the global environment.
pub fn log_dir_with_override(data_dir_override: Option<&str>) -> PathBuf {
    let base = data_dir_override
        .map(PathBuf::from)
        .or_else(|| std::env::var("MAINFRAME_DATA_DIR").ok().map(PathBuf::from))
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join(".mainframe")
        });
    base.join("logs")
}

/// Returns `${MAINFRAME_DATA_DIR}/logs` or `~/.mainframe/logs`.
pub fn log_dir() -> PathBuf {
    log_dir_with_override(None)
}

// ── Retention purge ───────────────────────────────────────────────────────────

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

// ── host_log command ──────────────────────────────────────────────────────────

/// Map a renderer LogLevel string to the appropriate tracing level and emit.
/// Degrades gracefully: unknown levels go to `info`.
fn emit_event(level: &str, module: &str, message: &str, data: Option<&serde_json::Value>) {
    // Serialize data to a string only when present; pass empty string as the
    // sentinel that PinoFormat uses to suppress the field.
    let data_str = match data {
        Some(v) => v.to_string(),
        None => String::new(),
    };
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

// ── Subscriber init ───────────────────────────────────────────────────────────

fn default_filter() -> tracing_subscriber::EnvFilter {
    tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "app_tauri_lib=info,warn".parse().unwrap())
}

/// Install the global tracing subscriber. Returns the `WorkerGuard` which MUST
/// be held alive for the entire process lifetime — dropping it flushes and
/// stops the async writer thread. Returns `None` on fallback (unwritable dir).
pub fn init_logging() -> Option<tracing_appender::non_blocking::WorkerGuard> {
    use tracing_appender::rolling::{RollingFileAppender, Rotation};
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

    // Builder API produces `app-tauri.<date>.log` (prefix.<date>.suffix),
    // matching pino's `<prefix>.<date>.log` filename convention exactly.
    let file_appender = match RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(LOG_PREFIX)
        .filename_suffix("log")
        .build(&dir)
    {
        Ok(a) => a,
        Err(e) => {
            // Init failure is non-fatal: degrade to stdout-only.
            tracing_subscriber::fmt()
                .with_env_filter(default_filter())
                .init();
            tracing::warn!(err = %e, "could not init rolling appender; stdout-only");
            return None;
        }
    };

    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    // Custom PinoFormat layer writes pino-compatible JSON lines to the file.
    let file_layer = tracing_subscriber::fmt::layer()
        .event_format(PinoFormat)
        .with_ansi(false)
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

    // ── log_dir: pure-function test (no env mutation, race-free) ─────────────

    #[test]
    fn log_dir_with_override_uses_supplied_dir() {
        assert_eq!(
            log_dir_with_override(Some("/tmp/mf-logtest")),
            PathBuf::from("/tmp/mf-logtest/logs")
        );
    }

    #[test]
    fn log_dir_with_no_override_falls_through_to_env_or_home() {
        // Just verify it returns *something* ending in /logs without touching
        // global env (the concrete value depends on the test runner's env).
        let d = log_dir_with_override(None);
        assert!(d.to_string_lossy().ends_with("/logs"));
    }

    // ── Retention purge ───────────────────────────────────────────────────────

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

    // ── PinoFormat JSON shape ─────────────────────────────────────────────────

    /// Write one line through the full subscriber (file-only, sync writer) and
    /// parse the resulting JSON to assert the pino-exact shape.
    #[test]
    fn pino_format_emits_correct_json_shape() {
        use tracing_subscriber::prelude::*;

        // Use a thread-local buffer as the writer so we can inspect output
        // without touching global state or the filesystem.
        let buf = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
        let buf_clone = buf.clone();

        let make_writer = move || {
            let b = buf_clone.clone();
            LockedWriter(b)
        };

        let layer = tracing_subscriber::fmt::layer()
            .event_format(PinoFormat)
            .with_ansi(false)
            .with_writer(make_writer);

        // Build a LOCAL subscriber (not the global one) to avoid interference
        // with other tests.
        let subscriber = tracing_subscriber::registry().with(layer);
        let _guard = tracing::subscriber::set_default(subscriber);

        tracing::info!(module = "auth", "hello world");

        let output = buf.lock().unwrap();
        let line = std::str::from_utf8(&output)
            .expect("utf8")
            .lines()
            .next()
            .expect("at least one line")
            .to_owned();

        let parsed: serde_json::Value =
            serde_json::from_str(&line).expect("valid JSON");

        // Required top-level keys with correct shapes.
        assert_eq!(parsed["level"], "INFO", "level must be UPPERCASE");
        assert!(
            parsed["time"].is_string(),
            "time must be a string"
        );
        let time_str = parsed["time"].as_str().unwrap();
        // ISO-8601 UTC: ends with Z
        assert!(
            time_str.ends_with('Z'),
            "time must be ISO-8601 UTC, got {time_str}"
        );
        assert!(
            parsed["pid"].is_u64(),
            "pid must be a number"
        );
        assert_eq!(parsed["pid"], std::process::id() as u64);
        assert_eq!(parsed["module"], "auth");
        assert_eq!(parsed["msg"], "hello world");

        // `data` must NOT be present when not supplied.
        assert!(
            parsed.get("data").is_none(),
            "data must be absent when not provided"
        );

        // No `fields` nesting (the old tracing-subscriber default shape).
        assert!(
            parsed.get("fields").is_none(),
            "fields nesting must not appear"
        );
    }

    #[test]
    fn pino_format_includes_data_when_present() {
        use tracing_subscriber::prelude::*;

        let buf = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
        let buf_clone = buf.clone();

        let make_writer = move || LockedWriter(buf_clone.clone());

        let layer = tracing_subscriber::fmt::layer()
            .event_format(PinoFormat)
            .with_ansi(false)
            .with_writer(make_writer);

        let subscriber = tracing_subscriber::registry().with(layer);
        let _guard = tracing::subscriber::set_default(subscriber);

        tracing::warn!(module = "net", data = %r#"{"key":"val"}"#, "something happened");

        let output = buf.lock().unwrap();
        let line = std::str::from_utf8(&output)
            .expect("utf8")
            .lines()
            .next()
            .expect("at least one line")
            .to_owned();

        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");

        assert_eq!(parsed["level"], "WARN");
        assert!(parsed.get("data").is_some(), "data must be present when supplied");
    }

    // ── Filename pattern: appender produces app-tauri.<date>.log ─────────────

    #[test]
    fn appender_produces_correct_filename_pattern() {
        use tracing_appender::rolling::{RollingFileAppender, Rotation};

        let dir = std::env::temp_dir()
            .join(format!("mf-filename-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let appender = RollingFileAppender::builder()
            .rotation(Rotation::DAILY)
            .filename_prefix(LOG_PREFIX)
            .filename_suffix("log")
            .build(&dir)
            .expect("appender build");

        // Write something to force file creation.
        {
            use std::io::Write as _;
            let (nb, _guard) = tracing_appender::non_blocking(appender);
            let mut w = nb;
            let _ = w.write_all(b"test\n");
        }

        // The created file must match `app-tauri.<date>.log`.
        let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let expected_name = format!("{LOG_PREFIX}.{date}.log");
        let exists = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy() == expected_name);

        std::fs::remove_dir_all(&dir).ok();
        assert!(exists, "expected file {expected_name} was not created");
    }

    // ── Helper: a MutexGuard-backed io::Write ─────────────────────────────────

    struct LockedWriter(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

    impl std::io::Write for LockedWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
}
