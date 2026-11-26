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

#[cfg(unix)]
fn request_terminate(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: a positive PID targets our own unreaped child.
    if pid > 0 && unsafe { libc::kill(pid, libc::SIGTERM) } == 0 {
        true
    } else {
        tracing::warn!(pid, error = %std::io::Error::last_os_error(), "SIGTERM to daemon sidecar failed");
        false
    }
}

/// No SIGTERM on Windows: the caller falls through to `Child::kill`.
#[cfg(not(unix))]
fn request_terminate(_pid: u32) -> bool {
    false
}
