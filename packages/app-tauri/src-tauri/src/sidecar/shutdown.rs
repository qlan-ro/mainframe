use super::*;

/// SIGTERM `child`, poll for its exit for up to `grace`, then SIGKILL it.
/// Returns its exit status once reaped. Polling `try_wait` on our own unreaped
/// child is safe: until it is reaped, its pid cannot name another process.
pub(super) fn stop_child(
    child: &mut Child,
    grace: Duration,
    poll: Duration,
) -> std::io::Result<ExitStatus> {
    if request_terminate(child.id()) {
        let deadline = Instant::now() + grace;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => return Ok(status),
                Ok(None) => {}
                Err(e) => {
                    tracing::warn!(err = %e, "daemon sidecar exit check failed, killing it");
                    break;
                }
            }
            if Instant::now() >= deadline {
                tracing::warn!(
                    pid = child.id(),
                    "daemon sidecar still running after SIGTERM, killing it"
                );
                break;
            }
            std::thread::sleep(poll);
        }
    }
    child.kill()?;
    child.wait()
}

/// Ask a process to shut down. Shells out to `kill` like the daemon itself
/// (no libc/nix bindings and no `unsafe` in this crate).
#[cfg(unix)]
fn request_terminate(pid: u32) -> bool {
    match Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
    {
        Ok(status) if status.success() => true,
        Ok(status) => {
            tracing::warn!(pid, %status, "SIGTERM to daemon sidecar failed");
            false
        }
        Err(e) => {
            tracing::warn!(pid, err = %e, "SIGTERM to daemon sidecar failed");
            false
        }
    }
}

/// No SIGTERM on Windows: the caller falls through to `Child::kill`.
#[cfg(not(unix))]
fn request_terminate(_pid: u32) -> bool {
    false
}
