use super::*;
use crate::test_support::{
    SignalLog, recorder, recording_signal, wait_until_trapped, write_chatty_cloudflared,
    write_counting_cloudflared, write_fake_cloudflared, write_ready_term_ignoring_cloudflared,
    write_silent_cloudflared, write_term_ignoring_cloudflared,
};
use std::sync::Mutex;

fn stopped_broadcasts(events: &Arc<Mutex<Vec<DaemonEvent>>>) -> usize {
    events
        .lock()
        .unwrap()
        .iter()
        .filter(|e| {
            matches!(
                e,
                DaemonEvent::TunnelStatus {
                    state: TunnelState::Stopped,
                    ..
                }
            )
        })
        .count()
}

/// Serve `count`-bounded canned HTTP responses, returning the base URL and a
/// shared hit counter. Each connection gets one response with `Connection:
/// close` so reqwest opens a fresh connection per request.
async fn serve_canned(
    status_line: &'static str,
    body: &'static str,
) -> (String, Arc<std::sync::atomic::AtomicUsize>) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let hits2 = hits.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            hits2.fetch_add(1, Ordering::SeqCst);
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            let response = format!(
                "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.shutdown().await;
        }
    });
    (format!("http://{addr}"), hits)
}

fn insert_ready(manager: &TunnelManager, label: &str, url: &str) {
    manager.tunnels.insert(
        label.to_string(),
        ManagedTunnel {
            process: TunnelProcess::exited_for_test(),
            url: url.to_string(),
            ready: true,
        },
    );
}

use crate::process::{BoxFuture, ManagedChildEntry, ManagedChildKind};

struct RecordingRegistry {
    added: Mutex<Vec<ManagedChildEntry>>,
    removed: Mutex<Vec<i64>>,
}

impl RecordingRegistry {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            added: Mutex::new(vec![]),
            removed: Mutex::new(vec![]),
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

fn manager_with(config: TunnelConfig, registry: Arc<dyn ChildRegistryPort>) -> TunnelManager {
    let mut manager = TunnelManager::with_config(None, config);
    manager.registry = registry;
    manager
}

/// Spawns `start` for `label` in a task and waits until its child is
/// recorded, returning the task and the child's pid.
async fn start_until_spawned(
    manager: &Arc<TunnelManager>,
    registry: &RecordingRegistry,
    label: &'static str,
) -> (tokio::task::JoinHandle<Result<String, String>>, u32) {
    let start_manager = manager.clone();
    let task = tokio::spawn(async move { start_manager.start(4173, label, None).await });
    let pid = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Some(entry) = registry.added().first() {
                break entry.pid as u32;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("cloudflared child should spawn");
    (task, pid)
}

fn signal_manager(
    bin: String,
    stop_grace: Duration,
    registry: Arc<RecordingRegistry>,
) -> (Arc<TunnelManager>, SignalLog) {
    let config = TunnelConfig {
        cloudflared_bin: bin,
        start_timeout: Duration::from_secs(10),
        dns_poll: Duration::from_millis(20),
        dns_timeout: Duration::from_millis(60),
        stop_grace,
        ..TunnelConfig::default()
    };
    let mut manager = manager_with(config, registry);
    let (signal, signals) = recording_signal();
    manager.set_signal(signal);
    (Arc::new(manager), signals)
}

async fn assert_pid_gone(pid: u32) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while mainframe_runtime::process::is_alive(pid) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the stopped child must no longer exist");
}

#[path = "behavior_tests.rs"]
mod behavior;
#[path = "shutdown_tests.rs"]
mod shutdown;

#[path = "shutdown_gate_tests.rs"]
mod shutdown_gate_tests;
