#![forbid(unsafe_code)]
#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "Test assertions and scenarios"
    )
)]
mod cli;
use tokio::signal;
use tracing::info;
const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main]
async fn main() {
    if cli::dispatch(DAEMON_VERSION).await {
        return;
    }
    run_daemon().await;
}

async fn run_daemon() {
    let parent_exit = watch_sidecar_parent();
    let (config, paths) = match mainframe_runtime::config::get_data_dir().and_then(|config_dir| {
        let config = mainframe_runtime::config::get_config()?;
        let paths = mainframe_runtime::config::boot_paths(&config, &config_dir);
        Ok((config, paths))
    }) {
        Ok(loaded) => loaded,
        Err(err) => {
            // Logging is not up yet: it needs the configured data directory.
            mainframe_runtime::logging::boot_error("failed to load config", &err);
            std::process::exit(1);
        }
    };
    let _log_guard = mainframe_runtime::logging::init(&paths.log_dir);

    // Resolve the login-shell PATH once at boot and thread it into every child
    // spawn (adapters, title generation, LSP, launch, background-task probes).
    // Mutating the process env is `unsafe` under edition 2024 and this crate is
    // `#![forbid(unsafe_code)]`, so the value is passed explicitly instead.
    let resolved_path = mainframe_runtime::ResolvedPath::resolve().await;

    // ensure_auth_secret(): generates + persists a secret if none exists. Env
    // mutation is `unsafe` under edition 2024, so the secret is threaded through
    // AppCtx instead of being set as AUTH_TOKEN_SECRET.
    let auth_secret = match mainframe_runtime::config::ensure_auth_secret() {
        Ok(secret) => Some(secret),
        Err(err) => fatal("failed to resolve auth secret", &err),
    };
    let boot = mainframe_server::bootstrap::Bootstrap::new(
        config,
        paths,
        resolved_path,
        auth_secret,
        DAEMON_VERSION.into(),
    );
    let bound = match boot.bind().await {
        Ok(bound) => bound,
        Err(error) => fatal("daemon boot failed", &error),
    };
    let daemon = match bound.build().await {
        Ok(daemon) => daemon,
        Err(error) => fatal("daemon assembly failed", &error),
    };
    if let Err(error) = daemon.serve(shutdown_signal(parent_exit)).await {
        fatal("daemon server failed", &error);
    }
}

/// Log a fatal boot error and exit. Boot failures have no supervisor to hand a
/// `Result` back to — the RUST RULES permit the abort only here, in `main`.
fn fatal(context: &str, err: &dyn std::fmt::Display) -> ! {
    tracing::error!(error = %err, "{context}");
    flush_and_exit(1);
}

/// Give the non-blocking log writer a beat to flush before exiting. `process::exit`
/// skips the `WorkerGuard` drop, so without this the fatal line can be dropped —
/// the silent death that hid the stale-daemon EADDRINUSE crash.
fn flush_and_exit(code: i32) -> ! {
    std::thread::sleep(std::time::Duration::from_millis(200));
    std::process::exit(code);
}

fn watch_sidecar_parent() -> Option<tokio::sync::oneshot::Receiver<()>> {
    #[cfg(unix)]
    {
        let parent = std::env::var("MAINFRAME_SIDECAR_PARENT_PID")
            .ok()?
            .parse()
            .ok()?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        match std::thread::Builder::new()
            .name("sidecar-parent".into())
            .spawn(move || {
                while mainframe_runtime::process::parent_pid() == Some(parent) {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
                let _ = sender.send(()); /* expected */
                std::thread::sleep(std::time::Duration::from_secs(10));
                tracing::error!("daemon did not exit after losing its host");
                flush_and_exit(1);
            }) {
            Ok(_) => Some(receiver),
            Err(err) => fatal("failed to watch sidecar parent", &err),
        }
    }
    #[cfg(not(unix))]
    None
}

async fn shutdown_signal(parent_exit: Option<tokio::sync::oneshot::Receiver<()>>) {
    let ctrl_c = async {
        // Boot-time signal handler installation failure is unrecoverable — the
        // process has no path forward without it — so this is treated as a
        // fatal boot condition per the RUST RULES exemption for main.rs boot.
        #[expect(
            clippy::expect_used,
            reason = "signal setup failure is fatal during boot"
        )]
        signal::ctrl_c()
            .await
            .expect("failed to install SIGINT handler");
    };

    #[cfg(unix)]
    let terminate = async {
        #[expect(
            clippy::expect_used,
            reason = "signal setup failure is fatal during boot"
        )]
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    let parent_lost = async {
        if let Some(exit) = parent_exit {
            if exit.await.is_err() {
                tracing::warn!("sidecar parent watcher stopped early");
            }
        } else {
            std::future::pending::<()>().await;
        }
    };

    tokio::select! {
        () = parent_lost => info!("desktop host exited"),
        () = ctrl_c => {}
        () = terminate => {}
    }
    info!("shutdown signal received, draining in-flight requests");
}
