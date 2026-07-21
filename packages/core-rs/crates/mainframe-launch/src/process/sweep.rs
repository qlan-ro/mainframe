//! Ported from `src/process/sweep.ts`.
//!
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

use tokio::process::Command;
use tokio::time::sleep;

use super::child_registry::{BoxFuture, ChildRegistryPort, ManagedChildEntry};

const PS_TIMEOUT: Duration = Duration::from_millis(5_000);
const SIGTERM_GRACE: Duration = Duration::from_millis(2_000);

/// Reads a pid's full command line / cwd, or `None` when unavailable.
pub type ProcessQueryFn = Arc<dyn Fn(i64) -> BoxFuture<'static, Option<String>> + Send + Sync>;

/// Delivers `signal` to `pid` (or its process group when `group`). Returns true
/// when the target was signalled or is already gone; false when the kill failed
/// for any other reason (e.g. EPERM), which tells the sweep to keep the record.
pub type KillFn = Arc<dyn Fn(i64, &'static str, bool) -> bool + Send + Sync>;

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
pub fn process_matches_binary(command: &str, bin_path: &str) -> bool {
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
pub fn process_matches_launch(
    command: Option<&str>,
    cwd: Option<&str>,
    entry: &ManagedChildEntry,
) -> bool {
    let Some(command) = command else {
        return false;
    };
    let recorded = if entry.args.is_empty() {
        entry.command.clone()
    } else {
        format!("{} {}", entry.command, entry.args.join(" "))
    };
    if command != recorded {
        return false;
    }
    // cwd is a hard guard: an unreadable (None) or differing cwd rejects the match.
    if let Some(entry_cwd) = &entry.cwd
        && cwd != Some(entry_cwd.as_str())
    {
        return false;
    }
    true
}

fn matches_entry(entry: &ManagedChildEntry, command: Option<&str>, cwd: Option<&str>) -> bool {
    let Some(command) = command else {
        return false;
    };
    if entry.group {
        process_matches_launch(Some(command), cwd, entry)
    } else {
        process_matches_binary(command, &entry.command)
    }
}

/// Re-read a pid's identity to decide whether the orphan (or its still-matching
/// group) survived our SIGTERM. Re-verifies the full command + cwd guard so a pid
/// reused during the grace window is treated as gone, never SIGKILLed.
async fn orphan_still_matches(entry: &ManagedChildEntry, deps: &SweepDeps) -> bool {
    let command = (deps.process_command)(entry.pid).await;
    let cwd = if command.is_some() && entry.group {
        (deps.process_cwd)(entry.pid).await
    } else {
        None
    };
    matches_entry(entry, command.as_deref(), cwd.as_deref())
}

/// Read a pid's full command line via `ps -o command=`.
pub async fn default_process_command(pid: i64) -> Option<String> {
    let fut = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output();
    match tokio::time::timeout(PS_TIMEOUT, fut).await {
        Ok(Ok(out)) if out.status.success() => {
            let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if line.is_empty() { None } else { Some(line) }
        }
        _ => None,
    }
}

/// Read a pid's working directory. macOS and Linux both expose it via `lsof`
/// (`-d cwd`, field `n`), avoiding the `/proc` vs BSD split. None on any failure.
pub async fn default_process_cwd(pid: i64) -> Option<String> {
    let fut = Command::new("lsof")
        .args(["-a", "-d", "cwd", "-p", &pid.to_string(), "-Fn"])
        .output();
    match tokio::time::timeout(PS_TIMEOUT, fut).await {
        Ok(Ok(out)) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            let line = text.lines().find(|l| l.starts_with('n'))?;
            let value = line[1..].trim();
            if value.is_empty() {
                None
            } else {
                Some(value.to_string())
            }
        }
        _ => None,
    }
}

/// pid the signal targets: the negative process-group id for a group kill.
fn kill_target(pid: i64, group: bool) -> i64 {
    if group { -pid } else { pid }
}

/// Map a `SIGx` signal name to the `kill(1)` flag (`SIGTERM` → `-TERM`).
fn signal_flag(signal: &str) -> String {
    format!("-{}", signal.strip_prefix("SIG").unwrap_or(signal))
}

/// Deliver a signal by shelling out to `kill` (house style — no libc/nix).
///
/// Divergence from the TS `process.kill`: a `kill(1)` non-zero exit (e.g. the
/// process died between the identity check and the signal — ESRCH) yields
/// `false` here, where the TS returns `true`. The record is then retained and
/// pruned on the next boot sweep (the pid reads as gone), so the only cost is a
/// one-run delay in an already-rare race.
pub fn default_kill(pid: i64, signal: &str, group: bool) -> bool {
    let target = kill_target(pid, group);
    // `--` is required: Linux `kill` parses a bare negative group target as a
    // signal spec and exits 0 without delivering anything.
    match std::process::Command::new("kill")
        .arg(signal_flag(signal))
        .arg("--")
        .arg(target.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
    {
        Ok(status) => status.success(),
        Err(err) => {
            tracing::warn!(target: "child-sweep", pid, signal, group, ?err, "sweep kill failed");
            false
        }
    }
}

/// Default deps: real `ps`/`lsof`/`kill` shell-outs.
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
                target: "child-sweep",
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
        let command = (deps.process_command)(entry.pid).await;
        let cwd = if command.is_some() && entry.group {
            (deps.process_cwd)(entry.pid).await
        } else {
            None
        };
        if !matches_entry(&entry, command.as_deref(), cwd.as_deref()) {
            tracing::debug!(
                target: "child-sweep",
                pid = entry.pid,
                kind = ?entry.kind,
                label = %entry.label,
                alive = command.is_some(),
                "pruning child registry entry (process gone or not ours)",
            );
            registry.remove(entry.pid).await;
            continue;
        }

        tracing::warn!(
            target: "child-sweep",
            pid = entry.pid,
            kind = ?entry.kind,
            label = %entry.label,
            group = entry.group,
            "reaping stray child orphaned by a previous daemon run",
        );
        let killed = (deps.kill)(entry.pid, "SIGTERM", entry.group);
        if !killed {
            tracing::warn!(
                target: "child-sweep",
                pid = entry.pid,
                kind = ?entry.kind,
                label = %entry.label,
                "kept child registry entry: kill failed, orphan may still be alive",
            );
            continue;
        }

        // `kill` reports signal delivery, not death. Mirror stop()'s TERM→KILL
        // ladder: after a grace period, SIGKILL an orphan (or its still-matching
        // group) that ignored or slow-handled SIGTERM before pruning its record.
        sleep(deps.grace.unwrap_or(SIGTERM_GRACE)).await;
        if orphan_still_matches(&entry, deps).await {
            tracing::warn!(
                target: "child-sweep",
                pid = entry.pid,
                kind = ?entry.kind,
                label = %entry.label,
                "orphan survived SIGTERM, sending SIGKILL",
            );
            (deps.kill)(entry.pid, "SIGKILL", entry.group);
        }
        reaped += 1;
        registry.remove(entry.pid).await;
    }

    SweepResult {
        total,
        reaped,
        skipped: total - reaped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::child_registry::{ManagedChildKind, NoopChildRegistry};
    use std::collections::{HashMap, HashSet};
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const BIN: &str = "/home/user/.mainframe/bin/bin/cloudflared";
    const PNPM: &str = "/opt/homebrew/bin/pnpm";
    const CWD: &str = "/Users/me/project";

    fn tunnel(pid: i64) -> ManagedChildEntry {
        tunnel_cmd(pid, BIN.to_string())
    }

    fn tunnel_cmd(pid: i64, command: String) -> ManagedChildEntry {
        ManagedChildEntry {
            pid,
            kind: ManagedChildKind::Tunnel,
            command,
            args: vec![],
            cwd: None,
            group: false,
            label: format!("preview:{pid}"),
            spawned_at: 0,
        }
    }

    fn launch(pid: i64) -> ManagedChildEntry {
        launch_args(
            pid,
            vec!["run".to_string(), "dev".to_string()],
            CWD.to_string(),
        )
    }

    fn launch_args(pid: i64, args: Vec<String>, cwd: String) -> ManagedChildEntry {
        ManagedChildEntry {
            pid,
            kind: ManagedChildKind::Launch,
            command: PNPM.to_string(),
            args,
            cwd: Some(cwd),
            group: true,
            label: format!("proj:{pid}"),
            spawned_at: 0,
        }
    }

    /// In-memory registry seeded with entries; `remove` records prunes so tests
    /// can assert reaped vs retained.
    struct FakeRegistry {
        entries: Mutex<Vec<ManagedChildEntry>>,
    }

    impl FakeRegistry {
        fn new(entries: Vec<ManagedChildEntry>) -> Arc<Self> {
            Arc::new(Self {
                entries: Mutex::new(entries),
            })
        }
        fn remaining(&self) -> Vec<i64> {
            self.entries.lock().unwrap().iter().map(|e| e.pid).collect()
        }
    }

    impl ChildRegistryPort for FakeRegistry {
        fn add(&self, _entry: ManagedChildEntry) -> BoxFuture<'_, ()> {
            Box::pin(async {})
        }
        fn remove(&self, pid: i64) -> BoxFuture<'_, ()> {
            Box::pin(async move {
                self.entries.lock().unwrap().retain(|e| e.pid != pid);
            })
        }
        fn list(&self) -> BoxFuture<'_, Vec<ManagedChildEntry>> {
            Box::pin(async move { self.entries.lock().unwrap().clone() })
        }
        fn list_by_kind(&self, _kind: ManagedChildKind) -> BoxFuture<'_, Vec<ManagedChildEntry>> {
            Box::pin(async { vec![] })
        }
        fn clear(&self) -> BoxFuture<'_, ()> {
            Box::pin(async {})
        }
    }

    /// Models a process that reports `command` for the identity guard, then
    /// disappears (the post-SIGTERM liveness re-check sees None) — the normal
    /// "dies on SIGTERM" path, so the sweep never escalates to SIGKILL.
    fn dies_on_sigterm(commands: HashMap<i64, Option<String>>) -> ProcessQueryFn {
        let seen = Arc::new(Mutex::new(HashSet::<i64>::new()));
        let commands = Arc::new(commands);
        Arc::new(move |pid| {
            let seen = seen.clone();
            let commands = commands.clone();
            Box::pin(async move {
                let mut seen = seen.lock().unwrap();
                if seen.contains(&pid) {
                    return None;
                }
                seen.insert(pid);
                commands.get(&pid).cloned().flatten()
            })
        })
    }

    fn constant_command(value: &'static str) -> ProcessQueryFn {
        Arc::new(move |_pid| Box::pin(async move { Some(value.to_string()) }))
    }

    fn constant_cwd(value: Option<&'static str>) -> ProcessQueryFn {
        Arc::new(move |_pid| Box::pin(async move { value.map(str::to_string) }))
    }

    fn none_command() -> ProcessQueryFn {
        Arc::new(|_pid| Box::pin(async { None }))
    }

    type KillCalls = Arc<Mutex<Vec<(i64, String, bool)>>>;

    /// Records every (pid, signal, group) the sweep delivers; returns `result`.
    fn recording_kill(result: bool) -> (KillFn, KillCalls) {
        let calls = Arc::new(Mutex::new(vec![]));
        let sink = calls.clone();
        let kill: KillFn = Arc::new(move |pid, sig, group| {
            sink.lock().unwrap().push((pid, sig.to_string(), group));
            result
        });
        (kill, calls)
    }

    #[test]
    fn binary_matches_the_exact_recorded_path() {
        assert!(process_matches_binary(
            &format!("{BIN} tunnel --url http://localhost:4173"),
            BIN
        ));
    }

    #[test]
    fn binary_rejects_a_non_absolute_recorded_path() {
        assert!(!process_matches_binary(
            "cloudflared tunnel run",
            "cloudflared"
        ));
    }

    #[test]
    fn binary_rejects_a_sibling_sharing_the_path_as_a_prefix() {
        assert!(!process_matches_binary(&format!("{BIN}-updater run"), BIN));
    }

    #[test]
    fn launch_matches_when_full_argv_and_cwd_match() {
        assert!(process_matches_launch(
            Some(&format!("{PNPM} run dev")),
            Some(CWD),
            &launch(1)
        ));
    }

    #[test]
    fn launch_matches_argv_only_invocation_with_matching_cwd() {
        assert!(process_matches_launch(
            Some(PNPM),
            Some(CWD),
            &launch_args(1, vec![], CWD.to_string())
        ));
    }

    #[test]
    fn launch_rejects_when_the_command_line_differs() {
        assert!(!process_matches_launch(
            Some("/usr/bin/postgres -D /data"),
            Some(CWD),
            &launch(1)
        ));
    }

    #[test]
    fn launch_rejects_when_only_a_fragment_of_the_argv_matches() {
        assert!(!process_matches_launch(
            Some(&format!("{PNPM} run dev --host")),
            Some(CWD),
            &launch(1)
        ));
    }

    #[test]
    fn launch_rejects_when_the_cwd_differs() {
        assert!(!process_matches_launch(
            Some(&format!("{PNPM} run dev")),
            Some("/Users/me/other"),
            &launch(1)
        ));
    }

    #[test]
    fn launch_rejects_when_the_live_cwd_is_unreadable() {
        assert!(!process_matches_launch(
            Some(&format!("{PNPM} run dev")),
            None,
            &launch(1)
        ));
    }

    fn deps(
        process_command: ProcessQueryFn,
        process_cwd: ProcessQueryFn,
        kill: KillFn,
    ) -> SweepDeps {
        SweepDeps {
            process_command,
            process_cwd,
            kill,
            platform: None,
            grace: Some(Duration::ZERO),
        }
    }

    #[tokio::test]
    async fn reaps_a_tunnel_by_pid_when_its_command_matches() {
        let registry = FakeRegistry::new(vec![tunnel(4242)]);
        let (kill, calls) = recording_kill(true);
        let result = sweep_stray_children(
            &*registry,
            &deps(
                dies_on_sigterm(HashMap::from([(
                    4242,
                    Some(format!("{BIN} tunnel --url http://localhost:4173")),
                )])),
                constant_cwd(None),
                kill,
            ),
        )
        .await;
        assert_eq!(
            *calls.lock().unwrap(),
            vec![(4242, "SIGTERM".to_string(), false)]
        );
        assert_eq!(
            result,
            SweepResult {
                total: 1,
                reaped: 1,
                skipped: 0
            }
        );
        assert_eq!(registry.remaining(), Vec::<i64>::new());
    }

    #[tokio::test]
    async fn reaps_a_launch_child_by_group_when_argv_and_cwd_match() {
        let registry = FakeRegistry::new(vec![launch(5000)]);
        let (kill, calls) = recording_kill(true);
        let result = sweep_stray_children(
            &*registry,
            &deps(
                dies_on_sigterm(HashMap::from([(5000, Some(format!("{PNPM} run dev")))])),
                constant_cwd(Some(CWD)),
                kill,
            ),
        )
        .await;
        assert_eq!(
            *calls.lock().unwrap(),
            vec![(5000, "SIGTERM".to_string(), true)]
        );
        assert_eq!(
            result,
            SweepResult {
                total: 1,
                reaped: 1,
                skipped: 0
            }
        );
        assert_eq!(registry.remaining(), Vec::<i64>::new());
    }

    #[tokio::test]
    async fn escalates_to_sigkill_when_a_launch_orphan_survives_sigterm() {
        let registry = FakeRegistry::new(vec![launch(5000)]);
        let (kill, calls) = recording_kill(true);
        let result = sweep_stray_children(
            &*registry,
            &deps(
                constant_command("/opt/homebrew/bin/pnpm run dev"),
                constant_cwd(Some(CWD)),
                kill,
            ),
        )
        .await;
        assert_eq!(
            *calls.lock().unwrap(),
            vec![
                (5000, "SIGTERM".to_string(), true),
                (5000, "SIGKILL".to_string(), true),
            ]
        );
        assert_eq!(
            result,
            SweepResult {
                total: 1,
                reaped: 1,
                skipped: 0
            }
        );
        assert_eq!(registry.remaining(), Vec::<i64>::new());
    }

    #[tokio::test]
    async fn does_not_escalate_when_the_orphan_exits_on_sigterm() {
        let registry = FakeRegistry::new(vec![launch(5000)]);
        let (kill, calls) = recording_kill(true);
        sweep_stray_children(
            &*registry,
            &deps(
                dies_on_sigterm(HashMap::from([(5000, Some(format!("{PNPM} run dev")))])),
                constant_cwd(Some(CWD)),
                kill,
            ),
        )
        .await;
        assert_eq!(
            *calls.lock().unwrap(),
            vec![(5000, "SIGTERM".to_string(), true)]
        );
    }

    #[tokio::test]
    async fn never_sigkills_a_pid_reused_during_the_grace_window() {
        let registry = FakeRegistry::new(vec![launch(5000)]);
        let (kill, calls) = recording_kill(true);
        let call = Arc::new(AtomicUsize::new(0));
        let process_command: ProcessQueryFn = Arc::new(move |_pid| {
            let call = call.clone();
            Box::pin(async move {
                let n = call.fetch_add(1, Ordering::SeqCst);
                Some(if n == 0 {
                    format!("{PNPM} run dev")
                } else {
                    "/usr/bin/postgres -D /data".to_string()
                })
            })
        });
        let result = sweep_stray_children(
            &*registry,
            &deps(process_command, constant_cwd(Some(CWD)), kill),
        )
        .await;
        assert_eq!(
            *calls.lock().unwrap(),
            vec![(5000, "SIGTERM".to_string(), true)]
        );
        assert_eq!(
            result,
            SweepResult {
                total: 1,
                reaped: 1,
                skipped: 0
            }
        );
        assert_eq!(registry.remaining(), Vec::<i64>::new());
    }

    #[tokio::test]
    async fn never_kills_a_launch_pid_reused_by_a_bystander_but_prunes_it() {
        let registry = FakeRegistry::new(vec![launch(5000)]);
        let (kill, calls) = recording_kill(true);
        let result = sweep_stray_children(
            &*registry,
            &deps(
                constant_command("/usr/bin/postgres -D /data"),
                constant_cwd(Some("/var/lib/postgres")),
                kill,
            ),
        )
        .await;
        assert!(calls.lock().unwrap().is_empty());
        assert_eq!(
            result,
            SweepResult {
                total: 1,
                reaped: 0,
                skipped: 1
            }
        );
        assert_eq!(registry.remaining(), Vec::<i64>::new());
    }

    #[tokio::test]
    async fn never_kills_a_launch_group_whose_cwd_no_longer_matches() {
        let registry = FakeRegistry::new(vec![launch(5000)]);
        let (kill, calls) = recording_kill(true);
        sweep_stray_children(
            &*registry,
            &deps(
                constant_command("/opt/homebrew/bin/pnpm run dev"),
                constant_cwd(Some("/Users/me/other")),
                kill,
            ),
        )
        .await;
        assert!(calls.lock().unwrap().is_empty());
        assert_eq!(registry.remaining(), Vec::<i64>::new());
    }

    #[tokio::test]
    async fn prunes_the_stale_record_of_a_pid_no_longer_alive() {
        let registry = FakeRegistry::new(vec![launch(5000)]);
        let (kill, calls) = recording_kill(true);
        let result =
            sweep_stray_children(&*registry, &deps(none_command(), constant_cwd(None), kill)).await;
        assert!(calls.lock().unwrap().is_empty());
        assert_eq!(
            result,
            SweepResult {
                total: 1,
                reaped: 0,
                skipped: 1
            }
        );
        assert_eq!(registry.remaining(), Vec::<i64>::new());
    }

    #[tokio::test]
    async fn reaps_matching_entries_out_of_a_mixed_set() {
        let registry = FakeRegistry::new(vec![tunnel(1), launch(2), launch(3)]);
        let (kill, calls) = recording_kill(true);
        let result = sweep_stray_children(
            &*registry,
            &deps(
                dies_on_sigterm(HashMap::from([
                    (1, Some(format!("{BIN} tunnel --url http://localhost:4173"))),
                    (2, Some(format!("{PNPM} run dev"))),
                    (3, Some("/opt/other/thing".to_string())),
                ])),
                constant_cwd(Some(CWD)),
                kill,
            ),
        )
        .await;
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert!(calls.contains(&(1, "SIGTERM".to_string(), false)));
        assert!(calls.contains(&(2, "SIGTERM".to_string(), true)));
        assert_eq!(
            result,
            SweepResult {
                total: 3,
                reaped: 2,
                skipped: 1
            }
        );
        assert_eq!(registry.remaining(), Vec::<i64>::new());
    }

    #[tokio::test]
    async fn leaves_the_registry_intact_and_reaps_nothing_on_win32() {
        let registry = FakeRegistry::new(vec![tunnel(1), launch(2)]);
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let process_command: ProcessQueryFn = Arc::new(move |_pid| {
            seen.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Some(format!("{BIN} tunnel run")) })
        });
        let (kill, kill_calls) = recording_kill(true);
        let result = sweep_stray_children(
            &*registry,
            &SweepDeps {
                process_command,
                process_cwd: constant_cwd(None),
                kill,
                platform: Some(SweepPlatform::Win32),
                grace: None,
            },
        )
        .await;
        assert!(kill_calls.lock().unwrap().is_empty());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(registry.remaining(), vec![1, 2]);
        assert_eq!(
            result,
            SweepResult {
                total: 2,
                reaped: 0,
                skipped: 2
            }
        );
    }

    #[tokio::test]
    async fn retains_the_record_of_a_still_alive_orphan_whose_kill_fails() {
        let registry = FakeRegistry::new(vec![launch(5000)]);
        let (kill, calls) = recording_kill(false);
        let result = sweep_stray_children(
            &*registry,
            &deps(
                constant_command("/opt/homebrew/bin/pnpm run dev"),
                constant_cwd(Some(CWD)),
                kill,
            ),
        )
        .await;
        assert_eq!(
            *calls.lock().unwrap(),
            vec![(5000, "SIGTERM".to_string(), true)]
        );
        assert_eq!(
            result,
            SweepResult {
                total: 1,
                reaped: 0,
                skipped: 1
            }
        );
        assert_eq!(registry.remaining(), vec![5000]);
    }

    // A JS `throw` from the kill dep is modeled as `false` (same sweep outcome:
    // record retained, not reaped) since a Rust `Fn -> bool` cannot unwind.
    #[tokio::test]
    async fn treats_a_failing_kill_as_a_failure_and_retains_the_record() {
        let registry = FakeRegistry::new(vec![launch(1), launch(2)]);
        let kill: KillFn = Arc::new(|pid, _sig, _group| pid != 1);
        let result = sweep_stray_children(
            &*registry,
            &deps(
                dies_on_sigterm(HashMap::from([
                    (1, Some(format!("{PNPM} run dev"))),
                    (2, Some(format!("{PNPM} run dev"))),
                ])),
                constant_cwd(Some(CWD)),
                kill,
            ),
        )
        .await;
        assert_eq!(
            result,
            SweepResult {
                total: 2,
                reaped: 1,
                skipped: 1
            }
        );
        assert_eq!(registry.remaining(), vec![1]);
    }

    #[tokio::test]
    async fn does_not_query_cwd_for_tunnels() {
        let registry = FakeRegistry::new(vec![tunnel(1)]);
        let queried = Arc::new(AtomicUsize::new(0));
        let counter = queried.clone();
        let process_cwd: ProcessQueryFn = Arc::new(move |_pid| {
            counter.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { None })
        });
        let (kill, _calls) = recording_kill(true);
        sweep_stray_children(
            &*registry,
            &deps(
                dies_on_sigterm(HashMap::from([(1, Some(format!("{BIN} tunnel run")))])),
                process_cwd,
                kill,
            ),
        )
        .await;
        assert_eq!(queried.load(Ordering::SeqCst), 0);
    }

    // defaultKill's ESRCH/EPERM branches are `process.kill`-specific (Node) and do
    // not translate to the `kill(1)` shell-out; the group→negative-pid target and
    // the signal-flag mapping are the portable, testable pieces.
    #[test]
    fn kill_targets_the_pid_when_not_a_group_kill() {
        assert_eq!(kill_target(4242, false), 4242);
    }

    #[test]
    fn kill_targets_the_negative_pid_for_a_group_kill() {
        assert_eq!(kill_target(4242, true), -4242);
    }

    #[test]
    fn signal_flag_maps_sig_names() {
        assert_eq!(signal_flag("SIGTERM"), "-TERM");
        assert_eq!(signal_flag("SIGKILL"), "-KILL");
    }

    #[test]
    fn noop_registry_is_a_child_registry_port() {
        // Compile-time proof the trait object type-checks for the sweep signature.
        fn _accepts(_r: &dyn ChildRegistryPort) {}
        _accepts(&NoopChildRegistry);
    }
}

// PORT STATUS: src/process/sweep.ts (220 lines)
// confidence: high
// todos: 0
// notes: sweep_stray_children + processMatchesBinary/Launch + orphanStillMatches
// ported 1:1 (same TERM→grace→KILL ladder, same prune-on-gone/reused/reaped, same
// win32 skip-and-keep, same EPERM-retain). SweepDeps holds Arc'd closures
// (process_command/process_cwd = async ProcessQueryFn, kill = sync Fn->bool);
// default_process_command/_cwd shell out to ps/lsof via tokio (5s timeout),
// default_kill shells out to `kill` (house style; ESRCH divergence documented on
// the fn). A JS `throw` from the kill dep maps to `false` (identical sweep
// outcome). All sweep.test.ts cases ported; the process.kill-specific defaultKill
// ESRCH/EPERM unit tests are covered by kill_target/signal_flag helper tests.
