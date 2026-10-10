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

type KillCalls = Arc<Mutex<Vec<(i64, Signal, bool)>>>;

/// Records every (pid, signal, group) the sweep delivers; returns `result`.
fn recording_kill(result: bool) -> (KillFn, KillCalls) {
    let calls = Arc::new(Mutex::new(vec![]));
    let sink = calls.clone();
    let kill: KillFn = Arc::new(move |pid, sig, group| {
        sink.lock().unwrap().push((pid, sig, group));
        result
    });
    (kill, calls)
}

fn deps(process_command: ProcessQueryFn, process_cwd: ProcessQueryFn, kill: KillFn) -> SweepDeps {
    SweepDeps {
        process_command,
        process_cwd,
        kill,
        platform: None,
        grace: Some(Duration::ZERO),
    }
}

// A failing kill dep returns `false`: the record is retained, not reaped.

mod cases_0;

mod cases_1;
