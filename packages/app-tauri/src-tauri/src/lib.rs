mod commands;
mod log_sink;
mod memory_logger;
mod menu;
mod presence;
mod preview;
mod shell_env;
mod sidecar;
mod terminal;
mod updater;

use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::{Emitter, Manager};
#[cfg(feature = "mcp-bridge")]
use tauri::ipc::CapabilityBuilder;

// Re-export commands at crate root so generate_handler! can find them.
use commands::{get_app_info, get_auth_token, get_homedir, get_platform, read_file, read_file_base64, show_item_in_folder};
use presence::{report_activity, DaemonPort};
use terminal::{terminal_create, terminal_write, terminal_resize, terminal_kill, TerminalManager};
use preview::{
    preview_capture, preview_create, preview_destroy, preview_eval, preview_inspect_result,
    preview_navigate, preview_open_external, preview_region_result, preview_set_bounds,
    preview_set_visible, PreviewManager,
};

/// The daemon handle lives for the entire app lifetime.
/// OnceLock ensures single-init; Drop isn't guaranteed on all platforms,
/// so we also kill on the `app::exit` event.
static DAEMON: OnceLock<sidecar::DaemonHandle> = OnceLock::new();

/// Daemon HTTP/WS port for this session. Configurable via the `daemon_port()` env
/// (the dev launch configs set it, alongside `VITE_DAEMON_HTTP_PORT`); falls back
/// to 31500 — non-default to avoid colliding with a system daemon on 31415.
fn daemon_port() -> u16 {
    std::env::var("daemon_port()")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(31500)
}

/// True when `MAINFRAME_EXTERNAL_DAEMON` opts out of spawning — the renderer then
/// connects to a daemon the user started themselves (matches the Electron flag).
fn external_daemon() -> bool {
    matches!(
        std::env::var("MAINFRAME_EXTERNAL_DAEMON").as_deref(),
        Ok("1") | Ok("true")
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Daily-rotating JSON log sink (renderer + host logs) — held for app lifetime.
    // WorkerGuard MUST outlive the tauri::Builder::run() call; binding it here
    // in run()'s top scope ensures it is dropped only after .run() returns.
    let _log_guard = log_sink::init_logging();

    // Start the 5-min RSS memory sampler (Task 10). Runs in a background thread;
    // logs via the tracing sink initialised above so output goes to the rotating
    // JSON log file (same sink as all other host logs).
    memory_logger::start_memory_logger();

    // ── C1: Capture the login-shell environment before doing anything else ──
    // This must happen before window creation so PATH is available when the
    // renderer asks for connection status.
    let shell_env = shell_env::resolve_shell_env_with_timeout();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    // Dev-only: MCP Bridge plugin (webview automation for the Tauri MCP server).
    // Behind the non-default `mcp-bridge` feature (enabled by `tauri:dev`) so the
    // crate is compiled out of release builds entirely.
    #[cfg(feature = "mcp-bridge")]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            get_auth_token,
            get_homedir,
            get_daemon_port,
            get_daemon_status,
            show_item_in_folder,
            read_file,
            read_file_base64,
            get_platform,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_kill,
            // renderer→host log sink (Plan 3, decision 3)
            log_sink::host_log,
            // presence reporter command (Plan 3, decision 4)
            report_activity,
            // preview child-webview commands
            preview_create,
            preview_navigate,
            preview_set_bounds,
            preview_set_visible,
            preview_capture,
            preview_destroy,
            preview_open_external,
            preview_inspect_result,
            preview_region_result,
            preview_eval,
            // auto-updater commands (Plan 3, decision 1)
            updater::updater_check,
            updater::updater_download,
            updater::updater_install,
        ])
        .setup(move |app| {
            // Build + set the native application menu. Errors are logged and the
            // app continues without a menu rather than panicking (degrade gracefully).
            match menu::build_menu(app.handle()) {
                Ok(m) => {
                    if let Err(e) = app.set_menu(m) {
                        tracing::warn!(err = %e, "failed to set application menu");
                    }
                }
                Err(e) => {
                    tracing::warn!(err = %e, "failed to build application menu");
                }
            }

            // Grant the mcp-bridge capability at runtime so it is absent from the
            // static capability set that ships in release builds. Mirrors the
            // `mcp-bridge`-feature plugin registration above.
            #[cfg(feature = "mcp-bridge")]
            if let Err(e) = app.add_capability(
                CapabilityBuilder::new("dev-mcp-bridge")
                    .window("main")
                    .permission("mcp-bridge:default"),
            ) {
                tracing::warn!(err = %e, "failed to add dev-mcp-bridge capability");
            }

            // Register the terminal manager (uses the same login-shell env as the
            // daemon so shells inherit the correct PATH/SHELL).
            app.manage(TerminalManager::new(shell_env.clone()));

            // Manage daemon port so the report_activity command can read it.
            app.manage(DaemonPort(daemon_port()));

            // Register the preview child-webview manager.
            app.manage(PreviewManager::new());

            // Boot the daemon from inside setup so we have an AppHandle available
            // for the bundled-resource resolver (packaged-build branch).
            let daemon_result = boot_daemon(app.handle(), &shell_env);

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

            // Start the OS-idle presence reporter (Plan 3, decision 4).
            // Spawns a background thread; mirrors idle-reporter.ts cadence.
            presence::start_presence_reporter(daemon_port());

            // Start the auto-updater periodic check scheduler (Plan 3, decision 1).
            // 10s initial check then every 4h — only in release builds.
            #[cfg(not(debug_assertions))]
            updater::schedule_update_checks(app.handle().clone());

            Ok(())
        })
        .on_page_load(|webview, payload| {
            // A hard reload of the MAIN webview (e.g. Cmd-R) re-runs the renderer
            // from scratch, but React unmount effects do NOT fire — so any preview
            // child webviews from the previous page are orphaned and stick on
            // screen. Tear them all down the moment the main webview starts
            // loading a new page. (Preview child webviews have non-"main" labels,
            // so their own loads never trigger this.)
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
            {
                if let Some(mgr) = webview.app_handle().try_state::<PreviewManager>() {
                    mgr.kill_all();
                }
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // POST idle on quit — mirrors idle-reporter.ts "before-quit" handler.
                // Routed through post_state_sync so the 500 ms connect/read timeout
                // applies and a wedged daemon cannot block window teardown.
                if let Err(e) = presence::post_state_sync(daemon_port(), presence::Presence::Idle) {
                    tracing::warn!(err = %e, "quit-path idle presence report failed");
                }

                // Kill the daemon when the last window closes.
                if let Some(h) = DAEMON.get() {
                    h.kill();
                }
                // Kill all PTY sessions — go through app_handle() because
                // try_state lives on Manager/AppHandle, not on &Window (M5).
                if let Some(mgr) = window.app_handle().try_state::<TerminalManager>() {
                    mgr.kill_all();
                }
                // Close all preview child webviews.
                // NOTE: pane/tab-level teardown is handled by the JS side
                // calling preview_destroy on each removed 'preview' run tab.
                if let Some(mgr) = window.app_handle().try_state::<PreviewManager>() {
                    mgr.kill_all();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn boot_daemon(
    app: &tauri::AppHandle,
    shell_env: &std::collections::HashMap<String, String>,
) -> Result<sidecar::DaemonHandle, String> {
    // External daemon: the user (or a separate process) runs the daemon themselves
    // (MAINFRAME_EXTERNAL_DAEMON) — don't spawn; the renderer connects to it on
    // daemon_port(). Mirrors the Electron `MAINFRAME_EXTERNAL_DAEMON` flag.
    if external_daemon() {
        tracing::info!(
            port = daemon_port(),
            "MAINFRAME_EXTERNAL_DAEMON set — not spawning; assuming an external daemon"
        );
        return Ok(sidecar::DaemonHandle::external());
    }

    let shell_path = shell_env.get("PATH").map(|s| s.as_str());
    // Release: prefer the bundled, ABI-matched Node sidecar. Debug/dev: ALWAYS use
    // the system Node so live `packages/core` edits take effect — even if leftover
    // bundle artifacts (`target/debug/node`) sit next to the dev binary from a prior
    // `bundle-daemon`/`provision-node` run. (`if cfg!` keeps `find_bundled_node`
    // referenced in both profiles — no dead-code warning.)
    let bundled_node = if cfg!(debug_assertions) {
        None
    } else {
        sidecar::find_bundled_node()
    };
    let node_bin = match bundled_node {
        Some(bundled) => bundled,
        None => sidecar::find_node(shell_path)?,
    };

    let daemon_entry = resolve_daemon_entry(app)?;

    tracing::info!(
        node = %node_bin.display(),
        daemon = %daemon_entry.display(),
        port = daemon_port(),
        "booting daemon sidecar"
    );

    sidecar::spawn_daemon(sidecar::SidecarConfig {
        node_bin,
        daemon_entry,
        shell_env: shell_env.clone(),
        daemon_port: daemon_port(),
        data_dir: None,
    })
}

/// Pure path-precedence selector (unit-testable, no AppHandle).
/// Precedence: bundled resource (packaged build) > env override > caller falls
/// back to the monorepo-root walk. Returns the first candidate that exists on disk.
fn pick_daemon_entry(bundled: Option<PathBuf>, env_override: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(p) = bundled {
        if p.exists() {
            return Some(p);
        }
    }
    if let Some(p) = env_override {
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Locate the compiled daemon entry point.
///
/// Precedence:
///   1. Bundled resource (`<resource_dir>/daemon/daemon.cjs`) — **release only**.
///   2. `MAINFRAME_DAEMON_PATH` env override — CI / manual test (both profiles).
///   3. Monorepo-root walk (`packages/core/dist/index.js`) — dev mode.
///
/// In debug/dev the bundled resource is skipped entirely, so `tauri dev` always
/// runs live `packages/core` even if a `target/debug/daemon/daemon.cjs` was left
/// behind by a prior bundle run. The explicit env override is still honored.
fn resolve_daemon_entry(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = if cfg!(debug_assertions) {
        None
    } else {
        app.path()
            .resource_dir()
            .ok()
            .map(|d| d.join("daemon").join("daemon.cjs"))
    };
    let env_override = std::env::var("MAINFRAME_DAEMON_PATH").ok().map(PathBuf::from);

    if let Some(found) = pick_daemon_entry(bundled, env_override.clone()) {
        tracing::info!(path = %found.display(), "daemon entry resolved (bundled/env)");
        return Ok(found);
    }
    // If the caller explicitly set MAINFRAME_DAEMON_PATH but the file is absent,
    // return an actionable error rather than silently falling through to dev mode.
    if let Some(p) = env_override {
        return Err(format!(
            "MAINFRAME_DAEMON_PATH={} does not exist",
            p.display()
        ));
    }

    // Dev fallback: walk up to the monorepo root (unchanged from the spike).
    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot determine exe path: {e}"))?;
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

// ── Resolver unit tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod resolver_tests {
    use super::pick_daemon_entry;

    /// Returns a temp-dir path unique to this process + a per-call counter so
    /// parallel test threads never collide on the same filename.
    fn unique_tmp(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "daemon-test-{}-{}-{}.cjs",
            std::process::id(),
            n,
            tag
        ))
    }

    #[test]
    fn prefers_bundled_resource_when_present() {
        let bundled = unique_tmp("bundled");
        std::fs::write(&bundled, b"// daemon").unwrap();
        let got = pick_daemon_entry(Some(bundled.clone()), None);
        std::fs::remove_file(&bundled).ok();
        assert_eq!(got, Some(bundled));
    }

    #[test]
    fn falls_back_to_env_override_when_no_bundle() {
        let env_path = unique_tmp("env");
        std::fs::write(&env_path, b"// daemon").unwrap();
        let got = pick_daemon_entry(None, Some(env_path.clone()));
        std::fs::remove_file(&env_path).ok();
        assert_eq!(got, Some(env_path));
    }

    #[test]
    fn returns_none_when_neither_exists() {
        let got = pick_daemon_entry(
            Some(unique_tmp("nope-bundle")),
            Some(unique_tmp("nope-env")),
        );
        assert_eq!(got, None);
    }
}

// ── Commands exposed to the renderer ─────────────────────────────────────────

#[tauri::command]
fn get_daemon_port() -> u16 {
    daemon_port()
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
