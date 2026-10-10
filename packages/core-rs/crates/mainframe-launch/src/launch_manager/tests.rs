use super::*;
use std::sync::Mutex as StdMutex;

fn recorder() -> (BroadcastFn, Arc<StdMutex<Vec<DaemonEvent>>>) {
    let events = Arc::new(StdMutex::new(Vec::new()));
    let sink = events.clone();
    let f: BroadcastFn = Arc::new(move |ev| sink.lock().unwrap().push(ev));
    (f, events)
}

fn cfg(name: &str, script: &str, port: Option<i64>) -> LaunchConfiguration {
    LaunchConfiguration {
        name: name.to_string(),
        runtime_executable: "sh".to_string(),
        runtime_args: vec!["-c".to_string(), script.to_string()],
        port,
        url: None,
        preview: Some(false),
        env: None,
    }
}

fn status_events(events: &Arc<StdMutex<Vec<DaemonEvent>>>) -> Vec<(String, LaunchProcessStatus)> {
    events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            DaemonEvent::LaunchStatus { name, status, .. } => Some((name.clone(), *status)),
            _ => None,
        })
        .collect()
}

fn output_events(events: &Arc<StdMutex<Vec<DaemonEvent>>>) -> Vec<(String, String)> {
    events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            DaemonEvent::LaunchOutput { name, data, .. } => Some((name.clone(), data.clone())),
            _ => None,
        })
        .collect()
}

fn manager(events: BroadcastFn) -> LaunchManager {
    LaunchManager::new("proj-1", "/tmp", events, None, None, None)
}

// --- clean_env (MAINFRAME_ORIG_PATH contract) ---

// --- compose_launch_env (the enrich-path → clean_env ordering `start` uses) ---

fn env_source(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

// --- LaunchManager (real spawned processes) ---

// Guards the `--` in the group-kill shell-out: Linux `kill` parses a bare
// `-<pid>` as a signal spec and exits 0 without delivering, which skipped
// the single-pid fallback and left every stopped child running to natural
// exit (each sleep-100 test above then took the full 100s on CI).

// --- output buffering (echo-once fast-subprocess race) ---

// --- port readiness ---

// --- registry tracking (launch child reaping) ---

use crate::process::{
    BoxFuture, ChildRegistryPort, FileChildRegistry, ManagedChildEntry, ManagedChildKind,
    default_sweep_deps, sweep_stray_children,
};
use std::os::unix::fs::PermissionsExt;

struct RecordingRegistry {
    added: StdMutex<Vec<ManagedChildEntry>>,
    removed: StdMutex<Vec<i64>>,
}

impl RecordingRegistry {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            added: StdMutex::new(vec![]),
            removed: StdMutex::new(vec![]),
        })
    }
    fn added(&self) -> Vec<ManagedChildEntry> {
        self.added.lock().unwrap().clone()
    }
    fn removed(&self) -> Vec<i64> {
        self.removed.lock().unwrap().clone()
    }
}

impl ChildRegistryPort for RecordingRegistry {
    fn add(&self, entry: ManagedChildEntry) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            self.added.lock().unwrap().push(entry);
        })
    }
    fn remove(&self, pid: i64) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            self.removed.lock().unwrap().push(pid);
        })
    }
    fn list(&self) -> BoxFuture<'_, Vec<ManagedChildEntry>> {
        Box::pin(async { vec![] })
    }
    fn list_by_kind(&self, _kind: ManagedChildKind) -> BoxFuture<'_, Vec<ManagedChildEntry>> {
        Box::pin(async { vec![] })
    }
    fn clear(&self) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }
}

fn reader(output: Option<&'static str>) -> ReadCommandFn {
    Arc::new(move |_pid| Box::pin(async move { output.map(str::to_string) }))
}

fn write_executable(path: &std::path::Path, body: &str) {
    std::fs::write(path, body).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn launch_cfg(name: &str, exe: &str, args: &[&str]) -> LaunchConfiguration {
    LaunchConfiguration {
        name: name.to_string(),
        runtime_executable: exe.to_string(),
        runtime_args: args.iter().map(|s| s.to_string()).collect(),
        port: None,
        url: None,
        preview: Some(false),
        env: None,
    }
}

async fn poll_added(registry: &RecordingRegistry) -> ManagedChildEntry {
    for _ in 0..80 {
        if let Some(entry) = registry.added().into_iter().next() {
            return entry;
        }
        sleep(Duration::from_millis(25)).await;
    }
    panic!("no launch pid was recorded");
}

// End-to-end proof (no mocks) that the real sweep reaps a launch orphan. The
// child is a #! shell script, so the kernel rewrites its argv — the exact case
// a bare-executable identity guard silently fails to match.
//
// Ignored on Linux: `process_matches_launch` compares the recorded command line
// against `ps -o command=`, and Linux reports a shebang child's argv differently
// than macOS, so this real-spawn integration test doesn't reap there. The daemon
// is macOS-verified only (Linux is a platform-matrix TODO); the
// 325-case unit matching tests still run on Linux. Revisit the matcher against
// real Linux `ps` output when Linux packaging is taken up.
#[cfg_attr(
    target_os = "linux",
    ignore = "sweep argv-match is macOS-shaped; Linux is a packaging TODO"
)]
mod cases_0;

mod cases_1;

mod cases_2;
