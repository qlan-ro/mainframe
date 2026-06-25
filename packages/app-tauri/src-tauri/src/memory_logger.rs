//! Periodic process-RSS sampler (parity with packages/desktop/src/main/memory-logger.ts).
//!
//! Electron samples the *renderer* process via `app.getAppMetrics()` and logs
//! `workingSetSizeKb` / `peakWorkingSetSizeKb` / `privateBytesKb`. Tauri's
//! WebView RSS is not cleanly separable from the host process, so this samples
//! the **host process RSS** instead (documented delta). The cadence is identical
//! (5 minutes). Log fields are `rss_bytes` (raw) + `rss_kb` (÷1024) for
//! rough parity with Electron's `*Kb` naming. Module tag: `host:perf`.
//!
//! ## sysinfo 0.31.4 API reconciliation
//! - `Process::memory()` returns **bytes** (not KB) on all platforms including
//!   macOS (backed by `proc_taskinfo::pti_resident_size`).
//! - The correct multi-process refresh is `System::refresh_processes_specifics`
//!   (note the plural) — `refresh_process_specifics` (singular) does not exist
//!   in 0.31.
//! - `ProcessesToUpdate::Some(&[pid])` refreshes only our PID, avoiding a full
//!   process-list scan every 5 minutes.

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

pub const MEMORY_LOG_INTERVAL_MS: u64 = 5 * 60 * 1000;

/// Current process resident-set size in bytes, if obtainable.
///
/// Creates a fresh `System`, refreshes only our PID's memory, and returns
/// the RSS value. Returns `None` if the PID is not found (e.g. on unsupported
/// platforms) or if `get_current_pid` fails.
pub fn sample_rss_bytes() -> Option<u64> {
    let pid = sysinfo::get_current_pid().ok()?;
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        ProcessRefreshKind::new().with_memory(),
    );
    sys.process(pid).map(|p| p.memory())
}

/// Convert raw bytes to kilobytes (integer division, matching Electron's *Kb fields).
#[inline]
pub fn bytes_to_kb(bytes: u64) -> u64 {
    bytes / 1024
}

/// Spawn a background thread that samples host-process RSS every 5 minutes
/// and logs it via `tracing`. If a sample fails, logs a warning and continues.
/// The thread is non-panicking: all fallible paths are handled.
pub fn start_memory_logger() {
    if let Err(e) = std::thread::Builder::new()
        .name("memory-logger".to_string())
        .spawn(|| loop {
            std::thread::sleep(std::time::Duration::from_millis(MEMORY_LOG_INTERVAL_MS));
            match sample_rss_bytes() {
                Some(rss) => tracing::info!(
                    module = "host:perf",
                    rss_bytes = rss,
                    rss_kb = bytes_to_kb(rss),
                    "host memory snapshot"
                ),
                None => tracing::warn!(module = "host:perf", "RSS sample unavailable"),
            }
        })
    {
        tracing::warn!(error = %e, "failed to spawn memory-logger thread; RSS sampling disabled");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rss_is_positive_for_this_process() {
        let rss = sample_rss_bytes();
        assert!(rss.is_some(), "expected an RSS reading for the test process");
        assert!(rss.unwrap() > 0, "RSS should be > 0");
    }

    #[test]
    fn bytes_to_kb_divides_correctly() {
        assert_eq!(bytes_to_kb(0), 0);
        assert_eq!(bytes_to_kb(1024), 1);
        assert_eq!(bytes_to_kb(1023), 0); // integer division
        assert_eq!(bytes_to_kb(2 * 1024 * 1024), 2048); // 2 MB → 2048 KB
        assert_eq!(bytes_to_kb(u64::MAX / 1024 * 1024), u64::MAX / 1024);
    }
}
