mod commands;
mod shell_env;
mod sidecar;

use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::{Emitter, Manager};

// Re-export commands at crate root so generate_handler! can find them.
use commands::{get_app_info, get_auth_token, get_homedir, get_platform, read_file, show_item_in_folder};

/// The daemon handle lives for the entire app lifetime.
/// OnceLock ensures single-init; Drop isn't guaranteed on all platforms,
/// so we also kill on the `app::exit` event.
static DAEMON: OnceLock<sidecar::DaemonHandle> = OnceLock::new();

/// Daemon port used for this session. Non-default to avoid collisions with
/// any existing dev daemon on 31415.
const DAEMON_PORT: u16 = 31500;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Set up structured logging early.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "app_tauri_lib=info,warn".parse().unwrap()),
        )
        .init();

    // ── C1: Capture the login-shell environment before doing anything else ──
    // This must happen before window creation so PATH is available when the
    // renderer asks for connection status.
    let shell_env = shell_env::resolve_shell_env_with_timeout();

    // Locate the daemon entry point and node binary using the shell env PATH.
    let daemon_result = boot_daemon(&shell_env);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());

    // Dev-only: MCP Bridge plugin (webview automation for the Tauri MCP server).
    // Shadowed under debug_assertions so it's compiled out of release builds.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            get_auth_token,
            get_homedir,
            get_daemon_port,
            get_daemon_status,
            show_item_in_folder,
            read_file,
            get_platform,
        ])
        .setup(move |app| {
            // Propagate any daemon-boot error to the renderer via the window title
            // (best-effort — the renderer polls get_daemon_status).
            if let Err(ref e) = daemon_result {
                tracing::error!(err = %e, "daemon failed to start");
            }

            // Emit daemon status to the main window once it's ready.
            let win = app.get_webview_window("main").expect("main window missing");
            let status = match &daemon_result {
                Ok(handle) => format!("started:pid={}", handle.pid().unwrap_or(0)),
                Err(e) => format!("error:{e}"),
            };
            win.emit("daemon:status", &status)
                .expect("emit daemon:status failed");

            // Store the handle for the lifetime of the app.
            if let Ok(handle) = daemon_result {
                let _ = DAEMON.set(handle);
            }

            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill the daemon when the last window closes.
                if let Some(h) = DAEMON.get() {
                    h.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn boot_daemon(
    shell_env: &std::collections::HashMap<String, String>,
) -> Result<sidecar::DaemonHandle, String> {
    let shell_path = shell_env.get("PATH").map(|s| s.as_str());
    let node_bin = sidecar::find_node(shell_path)?;

    let daemon_entry = resolve_daemon_entry()?;

    tracing::info!(
        node = %node_bin.display(),
        daemon = %daemon_entry.display(),
        port = DAEMON_PORT,
        "booting daemon sidecar"
    );

    sidecar::spawn_daemon(sidecar::SidecarConfig {
        node_bin,
        daemon_entry,
        shell_env: shell_env.clone(),
        daemon_port: DAEMON_PORT,
        data_dir: None,
    })
}

/// Locate the compiled daemon entry point.
///
/// For the spike we look for it relative to the monorepo root (dev mode).
/// In a packaged build this would be a bundled resource.
fn resolve_daemon_entry() -> Result<PathBuf, String> {
    // MAINFRAME_DAEMON_PATH lets tests/CI override the path (mirrors Electron).
    if let Ok(p) = std::env::var("MAINFRAME_DAEMON_PATH") {
        let path = PathBuf::from(&p);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!("MAINFRAME_DAEMON_PATH={p} does not exist"));
    }

    // Dev mode: locate relative to this binary's location by walking up to the
    // monorepo root and finding packages/core/dist/index.js.
    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot determine exe path: {e}"))?;

    // Walk up to find the pnpm-workspace.yaml (monorepo root).
    let mut dir = exe.as_path();
    loop {
        if dir.join("pnpm-workspace.yaml").exists() {
            let candidate = dir.join("packages/core/dist/index.js");
            if candidate.exists() {
                tracing::info!(path = %candidate.display(), "daemon entry found via monorepo root");
                return Ok(candidate);
            }
            return Err(format!(
                "monorepo root found at {} but packages/core/dist/index.js missing — run pnpm --filter @qlan-ro/mainframe-core build",
                dir.display()
            ));
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => break,
        }
    }

    Err("could not locate monorepo root (pnpm-workspace.yaml) — set MAINFRAME_DAEMON_PATH".to_string())
}

// ── Commands exposed to the renderer ─────────────────────────────────────────

#[tauri::command]
fn get_daemon_port() -> u16 {
    DAEMON_PORT
}

#[tauri::command]
fn get_daemon_status() -> String {
    match DAEMON.get() {
        Some(h) => match h.pid() {
            Some(pid) => format!("running:{pid}"),
            None => "exited".to_string(),
        },
        None => "not_started".to_string(),
    }
}
