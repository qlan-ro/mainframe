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

fn env_source(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

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
    let mut entry = None;
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(2),
        Duration::from_millis(25),
        async || {
            entry = registry.added().into_iter().next();
            entry.is_some()
        },
    )
    .await
    .expect("no launch pid was recorded");
    entry.unwrap()
}

#[path = "launch_manager_tests_child_registry.rs"]
mod child_registry;
#[path = "launch_manager_tests_clean_env.rs"]
mod clean_env;
#[path = "launch_manager_tests_events_and_output.rs"]
mod events_and_output;
#[path = "launch_manager_tests_exit_order.rs"]
mod exit_order;
#[path = "launch_manager_tests_start_stop.rs"]
mod start_stop;

async fn wait_until(predicate: impl Fn() -> bool) {
    mainframe_runtime::test_support::poll_until(
        Duration::from_secs(10),
        std::time::Duration::from_millis(5),
        async || !(!predicate()),
    )
    .await
    .expect("child process reached the expected state");
}
