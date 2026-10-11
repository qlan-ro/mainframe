#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
mod cli;
use tokio::signal;
use tracing::info;
const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main]
async fn main() {
    // `--version`/`version` is answered before logging init: no
    // logger noise on stdout, no daemon graph loaded. `pair`/`status` are thin
    // HTTP clients against the running daemon.
    match std::env::args().nth(1).as_deref() {
        Some("--version") | Some("-v") | Some("version") => {
            println!("mainframe {DAEMON_VERSION}");
            return;
        }
        Some("pair") => return cli::pair::run_pair().await,
        Some("status") => return cli::status::run_status().await,
        Some("update") => {
            let argv: Vec<String> = std::env::args().skip(2).collect();
            if let Err(err) = cli::update::run_update(argv).await {
                eprintln!("  {err}");
                std::process::exit(1);
            }
            return;
        }
        _ => {}
    }
    run_daemon().await;
}

async fn run_daemon() {
    let (config, paths) = match mainframe_runtime::config::get_data_dir().and_then(|config_dir| {
        let config = mainframe_runtime::config::get_config()?;
        let paths = mainframe_runtime::config::boot_paths(&config, &config_dir);
        Ok((config, paths))
    }) {
        Ok(loaded) => loaded,
        Err(err) => {
            // Logging is not up yet: it needs the configured data directory.
            eprintln!("failed to load config: {err}");
            std::process::exit(1);
        }
    };
    let _log_guard = mainframe_runtime::logging::init(&paths.log_dir);

    // Resolve the login-shell PATH once at boot and thread it into every child
    // spawn (adapters, title generation, LSP, launch, background-task probes).
    // Mutating the process env is `unsafe` under edition 2024 and this crate is
    // `#![forbid(unsafe_code)]`, so the value is passed explicitly instead.
    let resolved_path = mainframe_runtime::ResolvedPath::resolve();

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
    if let Err(error) = bound.build().await.serve(shutdown_signal()).await {
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

async fn shutdown_signal() {
    let ctrl_c = async {
        // Boot-time signal handler installation failure is unrecoverable — the
        // process has no path forward without it — so this is treated as a
        // fatal boot condition per the RUST RULES exemption for main.rs boot.
        #[allow(clippy::expect_used)]
        signal::ctrl_c()
            .await
            .expect("failed to install SIGINT handler");
    };

    #[cfg(unix)]
    let terminate = async {
        #[allow(clippy::expect_used)]
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
    info!("shutdown signal received, draining in-flight requests");
}
