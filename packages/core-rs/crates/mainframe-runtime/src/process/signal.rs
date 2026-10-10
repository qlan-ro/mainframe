use std::{future::Future, io, time::Duration};

use rustix::process::{self, Pid};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Signal {
    Term,
    Kill,
    Int,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Pid(u32),
    Group(u32),
}

fn checked_pid(raw: u32) -> io::Result<Pid> {
    let raw = i32::try_from(raw)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid process id"))?;
    Pid::from_raw(raw)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid process id"))
}

/// Deliver `signal` to `target`. `Ok(false)` means no such process (ESRCH):
/// the one policy for "already gone" across every consumer. Pid 0, negative
/// pids and overflowing values are rejected before reaching the kernel so a
/// bad value can never signal the caller's own group.
pub fn signal(target: Target, signal: Signal) -> io::Result<bool> {
    let sig = match signal {
        Signal::Term => process::Signal::TERM,
        Signal::Kill => process::Signal::KILL,
        Signal::Int => process::Signal::INT,
    };
    let result = match target {
        Target::Pid(raw) => process::kill_process(checked_pid(raw)?, sig),
        Target::Group(raw) => process::kill_process_group(checked_pid(raw)?, sig),
    };
    match result {
        Ok(()) => Ok(true),
        Err(rustix::io::Errno::SRCH) => Ok(false),
        Err(error) => Err(error.into()),
    }
}

pub fn is_alive(pid: u32) -> bool {
    checked_pid(pid).is_ok_and(|pid| {
        !matches!(
            process::test_kill_process(pid),
            Err(rustix::io::Errno::SRCH)
        )
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Terminated {
    Exited,
    Killed,
    StillRunning,
}

/// SIGTERM, then SIGKILL if `exited` has not completed within `grace`, then a
/// further `grace` before reporting [`Terminated::StillRunning`].
pub async fn terminate(
    target: Target,
    grace: Duration,
    exited: impl Future<Output = ()>,
) -> io::Result<Terminated> {
    terminate_with(|kind| signal(target, kind).map(|_| ()), grace, exited).await
}

/// [`terminate`] with the delivery step injected, for owners that route
/// signals through a watcher task or a test seam.
pub async fn terminate_with(
    mut send: impl FnMut(Signal) -> io::Result<()>,
    grace: Duration,
    exited: impl Future<Output = ()>,
) -> io::Result<Terminated> {
    tokio::pin!(exited);
    send(Signal::Term)?;
    if tokio::time::timeout(grace, &mut exited).await.is_ok() {
        return Ok(Terminated::Exited);
    }
    send(Signal::Kill)?;
    if tokio::time::timeout(grace, &mut exited).await.is_ok() {
        Ok(Terminated::Killed)
    } else {
        Ok(Terminated::StillRunning)
    }
}
