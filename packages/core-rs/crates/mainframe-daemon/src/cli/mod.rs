//! Command-line dispatch before daemon logging and service initialization.

pub mod pair;
pub mod status;
pub mod update;

/// `Cannot reach daemon at %s. Is it running?` — shared by every subcommand that
/// needs the daemon to already be running.
pub(crate) fn connect_failure_message(base_url: &str) -> String {
    format!("Cannot reach daemon at {base_url}. Is it running?")
}

pub(crate) async fn dispatch(version: &str) -> bool {
    // `--version`/`version` is answered before logging init: no
    // logger noise on stdout, no daemon graph loaded. `pair`/`status` are thin
    // HTTP clients against the running daemon.
    match std::env::args().nth(1).as_deref() {
        Some("--version") | Some("-v") | Some("version") => {
            println!("mainframe {version}");
            return true;
        }
        Some("pair") => {
            pair::run_pair().await;
            return true;
        }
        Some("status") => {
            status::run_status().await;
            return true;
        }
        Some("update") => {
            let argv: Vec<String> = std::env::args().skip(2).collect();
            if let Err(err) = update::run_update(argv).await {
                eprintln!("  {err}");
                std::process::exit(1);
            }
            return true;
        }
        _ => {}
    }
    false
}
