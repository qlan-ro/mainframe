//! `cloudflared` stand-ins and event recorders shared by this crate's tests.
//! `TunnelManager` and `PortTunnelRegistry` both drive real child processes, so
//! their tests need the same scripts.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::{Arc, Mutex};

use mainframe_types::events::DaemonEvent;

use crate::tunnel_manager::BroadcastFn;

/// A broadcast sink that keeps every event for later assertions.
pub(crate) fn recorder() -> (BroadcastFn, Arc<Mutex<Vec<DaemonEvent>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let f: BroadcastFn = Arc::new(move |ev| sink.lock().unwrap().push(ev));
    (f, events)
}

fn write_script(dir: &Path, name: &str, body: &str) -> String {
    let script = dir.join(name);
    std::fs::write(&script, body).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    script.to_string_lossy().into_owned()
}

/// Prints the URL + the registration line, then sleeps so the child stays alive.
pub(crate) fn write_fake_cloudflared(dir: &Path) -> String {
    write_script(
        dir,
        "fake-cloudflared.sh",
        "#!/bin/sh\necho 'https://abc-def.trycloudflare.com'\necho 'Registered tunnel connection'\nsleep 100\n",
    )
}

/// Keeps logging after registration, like the real binary (which dies on
/// SIGPIPE if the daemon stops reading its pipes).
pub(crate) fn write_chatty_cloudflared(dir: &Path) -> String {
    write_script(
        dir,
        "chatty-cloudflared.sh",
        "#!/bin/sh\necho 'https://abc-def.trycloudflare.com'\necho 'Registered tunnel connection'\nwhile true; do echo 'INF heartbeat'; sleep 0.05; done\n",
    )
}

/// Only sleeps — never prints a URL, so the tunnel stays mid-start (in
/// `pending`, not promoted into `tunnels`).
pub(crate) fn write_silent_cloudflared(dir: &Path) -> String {
    write_script(dir, "silent-cloudflared.sh", "#!/bin/sh\nsleep 100\n")
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
            "#!/bin/sh\necho spawn >> {log}\nn=$(wc -l < {log} | tr -d ' ')\necho \"https://abc-def$n.trycloudflare.com\"\necho 'Registered tunnel connection'\nsleep 100\n",
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
        "#!/bin/sh\nsleep 0.3\necho 'https://abc-def.trycloudflare.com'\necho 'Registered tunnel connection'\nsleep 100\n",
    )
}

/// Number of times a [`write_counting_cloudflared`] script has been spawned.
pub(crate) fn spawn_count(dir: &Path) -> usize {
    std::fs::read_to_string(dir.join("spawns.log"))
        .map(|s| s.lines().count())
        .unwrap_or(0)
}
