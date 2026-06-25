//! Auto-updater scaffold — Plan 3, decision 1.
//!
//! Implements three Tauri commands (`updater_check`, `updater_download`,
//! `updater_install`) plus a 10s-then-4h background scheduler that mirrors
//! `packages/app-electron/src/main/auto-updater.ts`. Signing keypair + CI release
//! workflow are deferred (see `docs/architecture/2026-06-24-host-bridge-plan3-infra-todos.md`).

pub mod error_classifier;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

use error_classifier::{classify, UpdateErrorKind};

/// Contract-shaped status (serde tagged on `state`) — mirrors
/// `UpdateStatusSchema` in `@qlan-ro/mainframe-types`. Plan 3, decision 1.
/// The JS bridge (`lib/tauri/bridge.ts`) listens on the `update:status` event
/// and `invoke`s the three commands below; tag/variant names MUST stay in sync.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum UpdateStatus {
    Checking,
    Available { version: String },
    NotAvailable,
    Downloading { percent: f64 },
    Downloaded { version: String },
    Error { message: String },
}

fn emit_status(app: &AppHandle, status: UpdateStatus) {
    if let Err(e) = app.emit("update:status", &status) {
        tracing::warn!(err = %e, "failed to emit update:status");
    }
}

/// Check for an update. Returns the resulting status and also emits it on
/// the `update:status` event channel. Transient network errors are suppressed
/// (returns `NotAvailable`) to match `auto-updater.ts` behavior.
///
/// Bridge: `invoke('updater_check')` in `lib/tauri/bridge.ts`.
#[tauri::command]
pub async fn updater_check(app: AppHandle) -> Result<UpdateStatus, String> {
    emit_status(&app, UpdateStatus::Checking);
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => {
            let status = UpdateStatus::Available {
                version: update.version.clone(),
            };
            emit_status(&app, status.clone());
            Ok(status)
        }
        Ok(None) => {
            let status = UpdateStatus::NotAvailable;
            emit_status(&app, status.clone());
            Ok(status)
        }
        Err(e) => {
            let message = e.to_string();
            // Suppress transient errors from the UI (parity with auto-updater.ts).
            if classify(&message) == UpdateErrorKind::Transient {
                tracing::warn!(message = %message, "transient update check error (suppressed)");
                let status = UpdateStatus::NotAvailable;
                emit_status(&app, status.clone());
                return Ok(status);
            }
            let status = UpdateStatus::Error {
                message: message.clone(),
            };
            emit_status(&app, status.clone());
            Err(message)
        }
    }
}

/// Download (and stage) the available update, emitting progress events.
/// Calls `update.download(on_chunk, on_finish)` → `Vec<u8>` then `update.install(bytes)`.
///
/// 2.x API reconciliation: `download` returns `Result<Vec<u8>>`; `install` is
/// a separate call that takes the bytes. `download_and_install` (used in
/// `updater_install`) wraps both in one call. The `on_chunk` closure receives
/// `(chunk_len: usize, total: Option<u64>)` — the percent is computed here.
///
/// Bridge: `invoke('updater_download')` in `lib/tauri/bridge.ts`.
#[tauri::command]
pub async fn updater_download(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("no update available to download".to_string());
    };
    let version = update.version.clone();
    let app2 = app.clone();
    let mut received: u64 = 0;
    let bytes = update
        .download(
            move |chunk_len, total| {
                received += chunk_len as u64;
                if let Some(total) = total {
                    let percent = (received as f64 / total as f64) * 100.0;
                    emit_status(&app2, UpdateStatus::Downloading { percent });
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    update.install(bytes).map_err(|e| e.to_string())?;
    emit_status(&app, UpdateStatus::Downloaded { version });
    Ok(())
}

/// Download (if needed) + install + relaunch. Uses `download_and_install`
/// which takes identical callback signatures to `download`.
///
/// Bridge: `invoke('updater_install')` in `lib/tauri/bridge.ts`.
#[tauri::command]
pub async fn updater_install(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("no update available to install".to_string());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

/// Fire-and-forget manual check (called from a menu item or keyboard shortcut).
/// Errors are logged, not propagated.
pub fn check_for_update_manual(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = updater_check(app).await {
            tracing::warn!(err = %e, "manual update check failed");
        }
    });
}

/// Schedule periodic update checks: fires after 10 s (app-startup grace period),
/// then every 4 h. Mirrors `auto-updater.ts:scheduleChecks` (lines 120–136).
///
/// The scheduler is spawned once from `lib.rs` setup under
/// `#[cfg(not(debug_assertions))]` so it doesn't run in dev mode.
pub fn schedule_update_checks(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Initial check after 10-second grace period (allows the UI to settle).
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        if let Err(e) = updater_check(app.clone()).await {
            tracing::warn!(err = %e, "scheduled update check (10s) failed");
        }

        // Subsequent checks every 4 hours.
        let mut interval =
            tokio::time::interval(std::time::Duration::from_secs(4 * 60 * 60));
        // The first tick fires immediately — consume it so we don't double-check.
        interval.tick().await;
        loop {
            interval.tick().await;
            if let Err(e) = updater_check(app.clone()).await {
                tracing::warn!(err = %e, "scheduled update check (4h) failed");
            }
        }
    });
}
