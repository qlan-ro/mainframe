//! `cloudflared` stand-ins and event recorders shared by this crate's tests.
//! `TunnelManager` and `PortTunnelRegistry` both drive real child processes, so
//! their tests need the same scripts.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mainframe_types::events::DaemonEvent;

use crate::tunnel_manager::BroadcastFn;

/// A broadcast sink that keeps every event for later assertions.
pub(crate) fn recorder() -> (BroadcastFn, Arc<Mutex<Vec<DaemonEvent>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let f: BroadcastFn = Arc::new(move |ev| sink.lock().unwrap().push(ev));
    (f, events)
}

/// Writes a `/bin/sh` stand-in and returns its path, proven executable.
///
/// A file written by one thread of a multi-threaded test binary can fail to
/// exec with `ETXTBSY`: a fork from another thread inherits the still-open
/// write descriptor, and the kernel refuses to exec a file anyone holds for
/// writing. The window closes as soon as that fork execs, so the probe below
/// retries until the script runs — otherwise a test reads the race as
/// "cloudflared failed to start", which is what it looks like from `start()`.
fn write_script(dir: &Path, name: &str, body: &str) -> String {
    let script = dir.join(name);
    std::fs::write(&script, format!("#!/bin/sh\n{PROBE_GUARD}\n{body}")).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

    let mut last = None;
    for _ in 0..100 {
        match std::process::Command::new(&script).arg(PROBE_ARG).status() {
            Ok(status) => {
                assert!(status.success(), "{name} ignored {PROBE_ARG}: {status}");
                return script.to_string_lossy().into_owned();
            }
            Err(err) => {
                last = Some(err);
                std::thread::sleep(Duration::from_millis(2));
            }
        }
    }
    panic!("{name} never became executable: {}", last.unwrap());
}

const PROBE_ARG: &str = "--mf-exec-probe";
const PROBE_GUARD: &str = r#"[ "$1" = --mf-exec-probe ] && exit 0"#;

/// Prints the URL + the registration line, then sleeps so the child stays alive.
pub(crate) fn write_fake_cloudflared(dir: &Path) -> String {
    write_script(
        dir,
        "fake-cloudflared.sh",
        "echo 'https://abc-def.trycloudflare.com'\necho 'Registered tunnel connection'\nsleep 100\n",
    )
}

/// Keeps logging after registration, like the real binary (which dies on
/// SIGPIPE if the daemon stops reading its pipes).
pub(crate) fn write_chatty_cloudflared(dir: &Path) -> String {
    write_script(
        dir,
        "chatty-cloudflared.sh",
        "echo 'https://abc-def.trycloudflare.com'\necho 'Registered tunnel connection'\nwhile true; do echo 'INF heartbeat'; sleep 0.05; done\n",
    )
}

/// Only sleeps — never prints a URL, so the tunnel stays mid-start (in
/// `pending`, not promoted into `tunnels`).
pub(crate) fn write_silent_cloudflared(dir: &Path) -> String {
    write_script(dir, "silent-cloudflared.sh", "sleep 100\n")
}

/// Like [`write_fake_cloudflared`], but appends one line to `spawns.log` and
/// mints a distinct URL per invocation, so tests can count spawns and tell a
/// reused tunnel from a respawned one.
pub(crate) fn write_counting_cloudflared(dir: &Path) -> String {
    let log = dir.join("spawns.log");
    write_script(
        dir,
        "counting-cloudflared.sh",
        &format!(
            "echo spawn >> {log}\nn=$(wc -l < {log} | tr -d ' ')\necho \"https://abc-def$n.trycloudflare.com\"\necho 'Registered tunnel connection'\nsleep 100\n",
            log = log.to_string_lossy()
        ),
    )
}

/// Like [`write_fake_cloudflared`], but stays quiet for 300ms first, leaving a
/// window in which the tunnel is genuinely mid-start.
pub(crate) fn write_slow_cloudflared(dir: &Path) -> String {
    write_script(
        dir,
        "slow-cloudflared.sh",
        "sleep 0.3\necho 'https://abc-def.trycloudflare.com'\necho 'Registered tunnel connection'\nsleep 100\n",
    )
}

/// Number of times a [`write_counting_cloudflared`] script has been spawned.
pub(crate) fn spawn_count(dir: &Path) -> usize {
    std::fs::read_to_string(dir.join("spawns.log"))
        .map(|s| s.lines().count())
        .unwrap_or(0)
}
