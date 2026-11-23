//! Reaps tunnel and launch children orphaned by a previous daemon run. Reads the
//! pidfile registry and, for each recorded pid still alive whose identity still
//! matches (guarding against PID reuse), kills it — the pid for tunnels, the
//! whole process GROUP for detached launch trees. Delivery escalates
//! SIGTERM → (grace) → SIGKILL. Every handled record is pruned; a record is kept
//! only when the orphan is still alive but the kill failed (EPERM). On win32 there
//! is no `ps`/`lsof` to inspect a pid, so the sweep skips and leaves the registry.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use mainframe_runtime::process::Signal;
use tokio::time::sleep;

use mainframe_types::BoxFuture;

use super::child_registry::{ChildRegistryPort, ManagedChildEntry};

const SIGTERM_GRACE: Duration = Duration::from_millis(2_000);

/// Reads a pid's full command line / cwd, or `None` when unavailable.
pub type ProcessQueryFn = Arc<dyn Fn(i64) -> BoxFuture<'static, Option<String>> + Send + Sync>;

/// Delivers a signal to `pid` (or its process group when `group`). Returns true
/// when the target was signalled or is already gone; false when the kill failed
/// for any other reason (e.g. EPERM), which tells the sweep to keep the record.
pub type KillFn = Arc<dyn Fn(i64, Signal, bool) -> bool + Send + Sync>;

/// Platform whose process-inspection tooling the sweep needs; win32 has no `ps`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SweepPlatform {
    Win32,
    Other,
}

fn current_platform() -> SweepPlatform {
    if cfg!(windows) {
        SweepPlatform::Win32
    } else {
        SweepPlatform::Other
    }
}

pub struct SweepDeps {
    /// Full command line of a running pid, or None when the pid is not alive.
    pub process_command: ProcessQueryFn,
    /// Working directory of a running pid, or None when unknown.
    pub process_cwd: ProcessQueryFn,
    pub kill: KillFn,
    /// Platform override; None resolves to the host platform.
    pub platform: Option<SweepPlatform>,
    /// Grace before escalating SIGTERM → SIGKILL; None uses `SIGTERM_GRACE` (tests pass 0).
    pub grace: Option<Duration>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SweepResult {
    pub total: usize,
    pub reaped: usize,
    pub skipped: usize,
}

/// Confirm a live process really is the tunnel child we spawned before killing
/// it. We require argv[0] to be the exact absolute binary recorded at spawn: a
/// bare name, a sibling binary sharing the path as a prefix (cloudflared-updater),
/// or the path appearing only as an argument (a log file) must NOT match, or the
/// sweep could kill an unrelated user process.
pub(crate) fn process_matches_binary(command: &str, bin_path: &str) -> bool {
    if !Path::new(bin_path).is_absolute() {
        return false;
    }
    command == bin_path || command.starts_with(&format!("{bin_path} "))
}

/// Confirm a live process really is the launch child we spawned. Launch children
/// run arbitrary user commands, so — unlike tunnels — we cannot rely on a known
/// binary. We require the FULL recorded argv to match the live command line
/// exactly (a fragment must not match) AND the recorded cwd to match the live
/// cwd. Either mismatch means the pid was reused.
pub(crate) fn process_matches_launch(
    command: &str,
    cwd: Option<&str>,
    entry: &ManagedChildEntry,
) -> bool {
    let recorded = if entry.args.is_empty() {
        entry.command.clone()
    } else {
        format!("{} {}", entry.command, entry.args.join(" "))
    };
    if command != recorded {
        return false;
    }
    // cwd is a hard guard: an unreadable (None) or differing cwd rejects the match.
    match &entry.cwd {
        Some(entry_cwd) => cwd == Some(entry_cwd.as_str()),
        None => true,
    }
}

/// Whether the process holding the record's pid is still the child the record
/// names, or `None` when no process holds the pid. Re-read after SIGTERM too,
/// so a pid reused during the grace window is never SIGKILLed.
async fn identity_matches(entry: &ManagedChildEntry, deps: &SweepDeps) -> Option<bool> {
    let command = (deps.process_command)(entry.pid).await?;
    let matches = if entry.group {
        let cwd = (deps.process_cwd)(entry.pid).await;
        process_matches_launch(&command, cwd.as_deref(), entry)
    } else {
        process_matches_binary(&command, &entry.command)
    };
    Some(matches)
}

pub(crate) async fn default_process_command(pid: i64) -> Option<String> {
    mainframe_runtime::process::inspect::command_line(u32::try_from(pid).ok()?, None).await
}

pub(crate) async fn default_process_cwd(pid: i64) -> Option<String> {
    mainframe_runtime::process::inspect::cwd(u32::try_from(pid).ok()?, None).await
}

/// Deliver a signal to `pid` or, for launch trees, its whole process group.
///
/// ESRCH (the orphan died between the identity check and the signal) counts
/// as delivered: the process is gone, so the record is pruned now instead of
/// being retained for the next boot's sweep. Any other failure (EPERM) returns
/// `false` and keeps the record.
pub(crate) fn default_kill(pid: i64, kind: Signal, group: bool) -> bool {
    use mainframe_runtime::process::{Target, signal};
    let Ok(pid) = u32::try_from(pid) else {
        return false;
    };
    let target = if group {
        Target::Group(pid)
    } else {
        Target::Pid(pid)
    };
    match signal(target, kind) {
        Ok(_) => true,
        Err(error) => {
            tracing::warn!(pid, %error, "sweep signal failed");
            false
        }
    }
}

/// Default process inspection and signal delivery.
pub fn default_sweep_deps() -> SweepDeps {
    SweepDeps {
        process_command: Arc::new(|pid| Box::pin(default_process_command(pid))),
        process_cwd: Arc::new(|pid| Box::pin(default_process_cwd(pid))),
        kill: Arc::new(default_kill),
        platform: None,
        grace: None,
    }
}

pub async fn sweep_stray_children(
    registry: &dyn ChildRegistryPort,
    deps: &SweepDeps,
) -> SweepResult {
    let entries = registry.list().await;
    let total = entries.len();
    let mut reaped = 0usize;

    let platform = deps.platform.unwrap_or_else(current_platform);
    if platform == SweepPlatform::Win32 {
        if total > 0 {
            tracing::warn!(
                total,
                "startup child sweep unsupported on win32; leaving registry intact so orphaned pids are not lost",
            );
        }
        return SweepResult {
            total,
            reaped: 0,
            skipped: total,
        };
    }

    for entry in entries {
        match reap_entry(deps, &entry).await {
            Reap::Reaped => {
                reaped += 1;
                registry.remove(entry.pid).await;
            }
            Reap::Prune => registry.remove(entry.pid).await,
            Reap::Keep => {}
        }
    }

    SweepResult {
        total,
        reaped,
        skipped: total - reaped,
    }
}

#[cfg(test)]
#[path = "sweep_tests.rs"]
mod tests;

/// What the sweep does with one record.
enum Reap {
    /// The orphan was signalled; drop its record.
    Reaped,
    /// The pid is gone or belongs to another process; drop the record.
    Prune,
    /// The orphan may still be alive (the kill failed); keep the record.
    Keep,
}

async fn reap_entry(deps: &SweepDeps, entry: &ManagedChildEntry) -> Reap {
    let identity = identity_matches(entry, deps).await;
    if identity != Some(true) {
        tracing::debug!(
            pid = entry.pid,
            kind = ?entry.kind,
            label = %entry.label,
            alive = identity.is_some(),
            "pruning child registry entry (process gone or not ours)",
        );
        return Reap::Prune;
    }

    tracing::warn!(
        pid = entry.pid,
        kind = ?entry.kind,
        label = %entry.label,
        group = entry.group,
        "reaping stray child orphaned by a previous daemon run",
    );
    if !(deps.kill)(entry.pid, Signal::Term, entry.group) {
        tracing::warn!(
            pid = entry.pid,
            kind = ?entry.kind,
            label = %entry.label,
            "kept child registry entry: kill failed, orphan may still be alive",
        );
        return Reap::Keep;
    }

    // `kill` reports signal delivery, not death. Mirror stop()'s TERM→KILL
    // ladder: after a grace period, SIGKILL an orphan (or its still-matching
    // group) that ignored or slow-handled SIGTERM before pruning its record.
    sleep(deps.grace.unwrap_or(SIGTERM_GRACE)).await;
    if identity_matches(entry, deps).await == Some(true) {
        tracing::warn!(
            pid = entry.pid,
            kind = ?entry.kind,
            label = %entry.label,
            "orphan survived SIGTERM, sending SIGKILL",
        );
        (deps.kill)(entry.pid, Signal::Kill, entry.group);
    }
    Reap::Reaped
}
