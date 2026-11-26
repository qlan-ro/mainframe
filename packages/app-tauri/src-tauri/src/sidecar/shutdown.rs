use super::*;

const KILL_GRACE: Duration = Duration::from_millis(500);

pub(super) fn stop_child(
    slot: &Mutex<OwnedChild>,
    grace: Duration,
    poll: Duration,
) -> std::io::Result<Option<ExitStatus>> {
    let sent_term = {
        let mut owned = slot.lock().unwrap_or_else(|e| e.into_inner());
        if owned.stopping || owned.process.is_none() {
            return Ok(None);
        }
        owned.stopping = true;
        owned
            .process
            .as_ref()
            .is_some_and(|child| request_terminate(child.id()))
    };
    if sent_term {
        match poll_reap(slot, grace, poll) {
            Ok(Some(status)) => return Ok(Some(status)),
            Ok(None) => {}
            Err(error) => tracing::warn!(%error, "daemon TERM wait failed"),
        }
    }

    kill_child(slot)?;
    poll_reap(slot, KILL_GRACE, poll)?.map_or_else(
        || {
            Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "daemon still present after KILL",
            ))
        },
        |status| Ok(Some(status)),
    )
}

pub(super) fn kill_child(slot: &Mutex<OwnedChild>) -> std::io::Result<()> {
    let mut owned = slot.lock().unwrap_or_else(|e| e.into_inner());
    if owned.kill_sent {
        return Ok(());
    }
    let Some(child) = owned.process.as_mut() else {
        return Ok(());
    };
    if child.try_wait()?.is_none() {
        child.kill()?;
    }
    owned.kill_sent = true;
    Ok(())
}

fn poll_reap(
    slot: &Mutex<OwnedChild>,
    grace: Duration,
    poll: Duration,
) -> std::io::Result<Option<ExitStatus>> {
    let deadline = Instant::now() + grace;
    loop {
        {
            let mut owned = slot.lock().unwrap_or_else(|e| e.into_inner());
            let Some(child) = owned.process.as_mut() else {
                return Ok(None);
            };
            if let Some(status) = child.try_wait()? {
                owned.process = None;
                return Ok(Some(status));
            }
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(None);
        }
        std::thread::sleep(poll.min(remaining));
    }
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
