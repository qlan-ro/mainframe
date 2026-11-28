mod commands;
mod daemon_launch;
mod env_boot;
mod log_sink;
#[cfg(feature = "mcp-bridge")]
mod mcp_bridge;
mod memory_logger;
mod menu;
mod presence;
mod preview;
mod quit;
mod shell_env;
mod sidecar;
mod terminal;
mod updater;

use std::path::PathBuf;

use tauri::{Emitter, Manager};

// Re-export commands at crate root so generate_handler! can find them.
use commands::{
    daemon_token_get, daemon_token_set, daemons_list, daemons_remove, daemons_upsert,
    get_app_info, get_auth_token, get_homedir, get_platform, open_path, read_file,
    read_file_base64, show_item_in_folder,
};
use presence::{report_activity, DaemonPort};
use terminal::{terminal_create, terminal_write, terminal_resize, terminal_kill, TerminalManager};
use preview::{
    preview_capture, preview_create, preview_destroy, preview_eval, preview_navigate,
    preview_set_bounds, preview_set_visible, PreviewManager,
};

/// Retains ownership of the sidecar for shutdown and memory sampling. Filled by the
/// background launch once the daemon env is ready (see `launch_daemon`).
static DAEMON: daemon_launch::DaemonSlot = daemon_launch::DaemonSlot::new();

/// Daemon HTTP/WS port for this session. Configurable via the `DAEMON_PORT` env
/// (the dev launch configs set it, alongside `VITE_DAEMON_HTTP_PORT`); falls back
/// to the daemon default.
fn daemon_port() -> u16 {
    parse_daemon_port(std::env::var("DAEMON_PORT").ok())
}

fn daemon_data_dir_override(raw: Option<std::ffi::OsString>) -> Option<PathBuf> {
    raw.map(PathBuf::from)
}

/// Parse a raw `DAEMON_PORT` value, falling back to 31415 when unset or invalid.
fn parse_daemon_port(raw: Option<String>) -> u16 {
    raw.and_then(|s| s.parse::<u16>().ok()).unwrap_or(31415)
}

/// True when `MAINFRAME_EXTERNAL_DAEMON` opts out of spawning — the renderer then
/// connects to a daemon the user started themselves (matches the Electron flag).
fn external_daemon() -> bool {
    matches!(
        std::env::var("MAINFRAME_EXTERNAL_DAEMON").as_deref(),
        Ok("1") | Ok("true")
    )
}

/// Whether the system appearance is dark, asked before any window exists. macOS only: `defaults`
/// exits non-zero when the appearance is light (the key is absent). Called by absolute path and
/// given a short deadline, so a stuck `cfprefsd` can delay startup by at most that long.
fn system_prefers_dark() -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::io::Read;
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};

        const DEADLINE: Duration = Duration::from_millis(250);
        let Ok(mut child) = Command::new("/usr/bin/defaults")
            .args(["read", "-g", "AppleInterfaceStyle"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            return false;
        };
        let started = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let mut out = String::new();
                    if status.success() {
                        if let Some(mut stdout) = child.stdout.take() {
                            let _ = stdout.read_to_string(&mut out);
                        }
                    }
                    return out.trim().eq_ignore_ascii_case("dark");
                }
                Ok(None) if started.elapsed() < DEADLINE => std::thread::sleep(Duration::from_millis(5)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return false;
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Daily-rotating JSON log sink (renderer + host logs) — held for app lifetime.
    // WorkerGuard MUST outlive the tauri::Builder::run() call; binding it here
    // in run()'s top scope ensures it is dropped only after .run() returns.
    let _log_guard = log_sink::init_logging();

    memory_logger::start_memory_logger();

    // ── C1: Login-shell environment ──
    // Start capturing it now, on a background thread, so it runs while Tauri
    // initialises. Nothing here waits for it: the window is created straight
    // away, and only the daemon launch (which needs PATH) waits — and not even
    // that when a cached capture is available. Until the daemon is spawned,
    // `get_daemon_status` answers `starting`.
    let env_boot = env_boot::EnvBoot::start(env_boot::EnvBootConfig::for_app());

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Window geometry persistence (position/size/monitor) — without it the
        // window opens on the primary display every launch.
        .plugin(tauri_plugin_window_state::Builder::new().build())
        // Child-preview → app callbacks; a plugin so the remote capability
        // (capabilities/preview.json) can grant exactly these four commands.
        .plugin(preview::bridge_plugin::init());

    // Dev/packaged-QA only: MCP Bridge plugin (webview automation for the Tauri
    // MCP server). Behind the non-default `mcp-bridge` feature (enabled by
    // `tauri:dev` or `mcp-bridge-qa`) so the crate is compiled out of release
    // builds entirely.
    #[cfg(feature = "mcp-bridge")]
    let builder = builder.plugin(mcp_bridge::plugin());

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
            open_path,
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
            preview_eval,
            // auto-updater commands (Plan 3, decision 1)
            updater::updater_check,
            updater::updater_download,
            updater::updater_install,
            // remote daemon registry + keyring token commands (Task B1t)
            daemons_list,
            daemons_upsert,
            daemons_remove,
            daemon_token_get,
            daemon_token_set,
        ])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            quit::install_native_quit(app.handle());
            // Build the main window ourselves (config has `"create": false`) so we can
            // attach `on_web_resource_request`. Tauri's asset protocol sends no
            // Cache-Control/ETag/Last-Modified headers, and WKWebView's disk cache can
            // keep serving bytes from a pre-update session across an in-place app
            // update because the tauri:// origin never changes — a version bump alone
            // doesn't invalidate it. `no-store` forces every asset request to hit the
            // current bundle, at effectively zero cost since these are local reads.
            let window_config = app.config().app.windows[0].clone();
            // The config colour is the light ground (`--sidebar`, `#f5f5f8`); on a dark system the
            // window is created with the dark ground (`#262626`) instead, so it never starts with
            // a mismatched frame. The persisted app theme lives in the webview's localStorage, which
            // the shell cannot read before the page loads: an app set to light on a dark system
            // still starts dark for the frames before `public/boot-theme.js` repaints the page.
            let mut window_builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)
                .expect("invalid main window config");
            if system_prefers_dark() {
                window_builder = window_builder.background_color(tauri::window::Color(38, 38, 38, 255));
            }
            let main_window = window_builder
                .on_web_resource_request(|_request, response| {
                    response.headers_mut().insert(
                        tauri::http::header::CACHE_CONTROL,
                        tauri::http::HeaderValue::from_static("no-store"),
                    );
                })
                .build()
                .expect("failed to create main window");
            tracing::info!("main window created");

            // Manually created windows are not auto-restored by the plugin —
            // reapply the saved geometry explicitly (no-op on first launch).
            {
                use tauri_plugin_window_state::{StateFlags, WindowExt};
                if let Err(e) = main_window.restore_state(StateFlags::all()) {
                    tracing::warn!(err = %e, "failed to restore window state");
                }
            }

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
            mcp_bridge::grant_capability(app.handle());

            // Register the terminal manager. It reads the shared login-shell env at
            // each spawn, so terminals pick up the fresh capture once it lands.
            app.manage(TerminalManager::new(env_boot.shared_env()));

            // Manage daemon port so the report_activity command can read it.
            app.manage(DaemonPort(daemon_port()));

            // Register the preview child-webview manager.
            app.manage(PreviewManager::new());

            // Spawns the daemon off the main thread once its env is ready.
            launch_daemon(app.handle().clone(), env_boot);

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
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(quit::on_run_event);
}

/// Launch the daemon on a background thread, then report it to the renderer.
///
/// With a cached login-shell env this spawns at once; otherwise it waits for the
/// capture (bounded by `env_boot::DAEMON_ENV_WAIT`, then the fallback env). The
/// window already exists, so the renderer polls `get_daemon_status` (`starting`
/// until the spawn) and receives `daemon:status` afterwards.
fn launch_daemon(app: tauri::AppHandle, env_boot: env_boot::EnvBoot) {
    let spawned = std::thread::Builder::new()
        .name("daemon-launch".into())
        .spawn(move || {
            // External daemon: the user (or a separate process) runs the daemon
            // themselves (MAINFRAME_EXTERNAL_DAEMON) — don't spawn and don't wait
            // for the env; the renderer connects to it on daemon_port().
            let launched = if external_daemon() {
                tracing::info!(
                    port = daemon_port(),
                    "MAINFRAME_EXTERNAL_DAEMON set — not spawning; assuming an external daemon"
                );
                DAEMON.launch(|| Ok(sidecar::DaemonHandle::external()))
            } else {
                // `launch_with` logs which env (cached / login_shell / fallback) it used.
                daemon_launch::launch_with(&DAEMON, &env_boot, |env, _source| boot_rust_daemon(env))
            };
            let Some(result) = launched else { return };
            report_daemon_launch(&app, result);
        });
    if let Err(err) = spawned {
        tracing::error!(error = %err, "could not start the daemon launch thread");
    }
}

fn report_daemon_launch(app: &tauri::AppHandle, result: Result<&sidecar::DaemonHandle, String>) {
    let status = match &result {
        Ok(handle) => format!("started:pid={}", handle.pid().unwrap_or(0)),
        Err(err) => {
            tracing::error!(error = %err, "daemon failed to start");
            format!("error:{err}")
        }
    };
    if let Err(err) = app.emit("daemon:status", &status) {
        tracing::warn!(error = %err, "could not emit daemon:status");
    }

    // Surface an unexpected daemon death (bind failure, crash) to the renderer —
    // otherwise the UI keeps polling a port that may be owned by a stale daemon
    // and everything skews silently.
    if let Ok(handle) = result {
        let app_handle = app.clone();
        handle.watch_exit(move |code| {
            let code_label = code.map(|c| c.to_string()).unwrap_or_else(|| "signal".into());
            tracing::error!(code = %code_label, "daemon sidecar exited unexpectedly");
            if let Some(win) = app_handle.get_webview_window("main") {
                let _ = win.emit("daemon:status", &format!("error:daemon exited (code {code_label})"));
            }
        });
    }
}

/// Boot the Rust `mainframe-daemon` binary directly.
///
/// The daemon reads DAEMON_PORT + MAINFRAME_DATA_DIR from its own env; the
/// login-shell env (incl. PATH) is passed through as the daemon's own env so it
/// AND its adapter children inherit the resolved PATH.
fn boot_rust_daemon(
    shell_env: &std::collections::HashMap<String, String>,
) -> Result<sidecar::DaemonHandle, String> {
    let daemon_bin = resolve_rust_daemon_bin()?;

    tracing::info!(
        daemon = %daemon_bin.display(),
        port = daemon_port(),
        "booting rust daemon sidecar"
    );

    sidecar::spawn_daemon(sidecar::SidecarConfig {
        program: sidecar::DaemonProgram { daemon_bin },
        shell_env: shell_env.clone(),
        daemon_port: daemon_port(),
        data_dir: daemon_data_dir_override(std::env::var_os("MAINFRAME_DATA_DIR")),
    })
}

/// Locate the Rust `mainframe-daemon` binary.
///
/// Precedence:
///   1. `MAINFRAME_RUST_DAEMON_PATH` env override — dev / CI (both profiles).
///   2. Bundled externalBin next to the exe — **release only**.
///   3. Monorepo `packages/core-rs/target/{release,debug}/mainframe-daemon` — dev.
///
/// In debug the bundled binary is skipped so a stale packaged artifact never
/// shadows a fresh `cargo build`. An explicit env override is always honored.
fn resolve_rust_daemon_bin() -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("MAINFRAME_RUST_DAEMON_PATH") {
        let path = PathBuf::from(&raw);
        if path.exists() {
            tracing::info!(path = %path.display(), "rust daemon resolved (env override)");
            return Ok(path);
        }
        return Err(format!("MAINFRAME_RUST_DAEMON_PATH={raw} does not exist"));
    }

    if !cfg!(debug_assertions) {
        if let Some(bundled) = sidecar::find_bundled_rust_daemon() {
            tracing::info!(path = %bundled.display(), "rust daemon resolved (bundled)");
            return Ok(bundled);
        }
    }

    // Dev fallback: walk up to the monorepo root, prefer a release build.
    let exe = std::env::current_exe().map_err(|e| format!("cannot determine exe path: {e}"))?;
    let bin_name = format!("mainframe-daemon{}", std::env::consts::EXE_SUFFIX);
    let mut dir = exe.as_path();
    loop {
        if dir.join("pnpm-workspace.yaml").exists() {
            for profile in ["release", "debug"] {
                let candidate = dir
                    .join("packages/core-rs/target")
                    .join(profile)
                    .join(&bin_name);
                if candidate.exists() {
                    tracing::info!(path = %candidate.display(), "rust daemon resolved (monorepo)");
                    return Ok(candidate);
                }
            }
            return Err(format!(
                "monorepo root at {} but no {bin_name} in packages/core-rs/target/{{release,debug}} — run `cargo build --release -p mainframe-daemon` in packages/core-rs or set MAINFRAME_RUST_DAEMON_PATH",
                dir.display()
            ));
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => break,
        }
    }

    Err("could not locate monorepo root (pnpm-workspace.yaml) — set MAINFRAME_RUST_DAEMON_PATH"
        .to_string())
}

// ── Resolver unit tests ───────────────────────────────────────────────────────

#[cfg(test)]
mod daemon_port_tests {
    use super::{daemon_data_dir_override, daemon_port, parse_daemon_port};
    use std::path::PathBuf;

    #[test]
    fn parse_uses_value_then_falls_back() {
        assert_eq!(parse_daemon_port(Some("31416".into())), 31416);
        assert_eq!(parse_daemon_port(Some("not-a-port".into())), 31415);
        assert_eq!(parse_daemon_port(None), 31415);
    }

    // Regression: the reader used a malformed env-var name (`"daemon_port()"`)
    // and always returned the fallback, ignoring the launch config's
    // `DAEMON_PORT` — so the dev shell could never reach the configured daemon.
    #[test]
    fn daemon_port_reads_the_daemon_port_env() {
        std::env::set_var("DAEMON_PORT", "31416");
        assert_eq!(daemon_port(), 31416);
        std::env::remove_var("DAEMON_PORT");
        assert_eq!(daemon_port(), 31415);
    }

    #[test]
    fn daemon_data_dir_override_reads_mainframe_data_dir_env() {
        let dir = std::ffi::OsString::from("/tmp/mainframe-tauri-test-data");

        assert_eq!(
            daemon_data_dir_override(Some(dir.clone())),
            Some(PathBuf::from(dir))
        );
        assert_eq!(daemon_data_dir_override(None), None);
    }
}

// ── Commands exposed to the renderer ─────────────────────────────────────────

#[tauri::command]
fn get_daemon_port() -> u16 {
    daemon_port()
}

#[tauri::command]
fn get_daemon_status() -> String {
    DAEMON.status()
}
