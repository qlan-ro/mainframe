//! Shared integration-test harness: spawns `build_app` on an ephemeral port with
//! a real in-memory DB + real service collaborators (no mocks), plus a minimal
//! hand-rolled RFC-6455 WebSocket client (no ws client crate is in the workspace
//! allowlist).
#![allow(clippy::unwrap_used, clippy::expect_used, dead_code)]

use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use mainframe_db::DatabaseManager;
use mainframe_server::ctx::{AppCtx, GitFactory, Services};
use mainframe_server::db::Db;
use mainframe_server::{build_app, spawn_broadcast_pump};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_types::events::DaemonEvent;
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

pub struct TestServer {
    pub addr: SocketAddr,
    pub ctx: Arc<AppCtx>,
    _data_dir: TempDir,
}

/// Spawn `build_app` on `127.0.0.1:0` with a fully real AppCtx (in-memory SQLite
/// via the Db actor, real AttachmentStore/PushService/FileWatcherService). Serves
/// with connect-info so the auth middleware + WS upgrade can read the peer IP.
pub async fn spawn_test_server(auth_secret: Option<String>) -> TestServer {
    let data_dir = tempfile::tempdir().unwrap();
    let db = Db::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap();
    let (broadcast, _keepalive) = tokio::sync::broadcast::channel::<DaemonEvent>(1024);
    let watcher_tx = broadcast.clone();
    let watcher = FileWatcherService::new(move |event| {
        let _ = watcher_tx.send(event);
    });
    let ctx = Arc::new(AppCtx {
        db,
        git: GitFactory,
        services: Services {
            attachments: Arc::new(AttachmentStore::new(data_dir.path().join("attachments"))),
            push: Arc::new(PushService::new()),
            watcher: Arc::new(watcher),
        },
        broadcast,
        adapter_registry: Arc::new(mainframe_adapter_api::AdapterRegistry::new()),
        background_tasks: Arc::new(
            mainframe_background_tasks::tracker::BackgroundTaskTracker::new(),
        ),
        chat_manager: None,
        launch_registry: None,
        tunnel_manager: None,
        lsp_manager: None,
        plugin_manager: None,
        automations: None,
        data_dir: data_dir.path().to_path_buf(),
        version: "0.0.0-test".to_string(),
        port: 0,
        auth_secret,
        resolved_path: mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
        tunnel_url: Arc::new(std::sync::RwLock::new(None)),
        ws_clients: Arc::new(DashMap::new()),
    });
    spawn_broadcast_pump(Arc::clone(&ctx));

    let app = build_app(Arc::clone(&ctx));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let served = ctx.clone();
    tokio::spawn(async move {
        let _ = served; // keep ctx alive for the lifetime of the server task
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
    });

    // Give the listener a beat to start accepting.
    tokio::time::sleep(Duration::from_millis(20)).await;
    TestServer {
        addr,
        ctx,
        _data_dir: data_dir,
    }
}

impl TestServer {
    pub fn http_url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }

    /// Register a device and return a token minted at its current auth epoch.
    pub async fn register_device_token(&self, secret: &str, device_id: &str) -> String {
        let did = device_id.to_string();
        let epoch = self
            .ctx
            .db
            .call(move |db| {
                db.devices.add(&did, "Test Device")?;
                db.devices.increment_auth_epoch(&did)
            })
            .await
            .unwrap();
        mainframe_runtime::auth::generate_token(secret, device_id, Some(epoch))
    }

    /// Create a project row and return its generated id.
    pub async fn create_project(&self, path: &str) -> String {
        let path = path.to_string();
        self.ctx
            .db
            .call(move |db| db.projects.create(&path, None))
            .await
            .unwrap()
            .id
    }
}

/// Minimal RFC-6455 text-frame client over a raw `TcpStream`.
pub struct WsClient {
    stream: BufReader<TcpStream>,
}

impl WsClient {
    /// Perform the upgrade handshake. Returns `Err(status)` if the server does
    /// not answer `101` (e.g. a `401` auth rejection).
    pub async fn connect(
        addr: SocketAddr,
        target: &str,
        forwarded_for: Option<&str>,
    ) -> Result<Self, u16> {
        let stream = TcpStream::connect(addr).await.unwrap();
        let mut stream = stream;
        let mut request = format!(
            "GET {target} HTTP/1.1\r\nHost: {addr}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
             Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n"
        );
        if let Some(xff) = forwarded_for {
            request.push_str(&format!("X-Forwarded-For: {xff}\r\n"));
        }
        request.push_str("\r\n");
        stream.write_all(request.as_bytes()).await.unwrap();

        let mut reader = BufReader::new(stream);
        let mut status_line = String::new();
        reader.read_line(&mut status_line).await.unwrap();
        let code: u16 = status_line
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        loop {
            let mut line = String::new();
            let n = reader.read_line(&mut line).await.unwrap();
            if n == 0 || line == "\r\n" {
                break;
            }
        }
        if code != 101 {
            return Err(code);
        }
        Ok(Self { stream: reader })
    }

    /// Send a text frame (client frames are masked, per spec).
    pub async fn send_text(&mut self, text: &str) {
        let payload = text.as_bytes();
        let key = [0x12u8, 0x34, 0x56, 0x78];
        let mut frame = vec![0x81u8];
        let len = payload.len();
        if len < 126 {
            frame.push(0x80 | len as u8);
        } else if len < 65536 {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(len as u16).to_be_bytes());
        } else {
            frame.push(0x80 | 127);
            frame.extend_from_slice(&(len as u64).to_be_bytes());
        }
        frame.extend_from_slice(&key);
        for (i, b) in payload.iter().enumerate() {
            frame.push(b ^ key[i % 4]);
        }
        self.stream.get_mut().write_all(&frame).await.unwrap();
    }

    /// Send a serializable JSON event.
    pub async fn send_json(&mut self, value: &serde_json::Value) {
        self.send_text(&value.to_string()).await;
    }

    /// Read the next text frame's payload, skipping ping/pong; `None` on close.
    pub async fn read_text(&mut self) -> Option<String> {
        loop {
            let b0 = self.next_byte().await?;
            let b1 = self.next_byte().await?;
            let opcode = b0 & 0x0F;
            let masked = b1 & 0x80 != 0;
            let len = match b1 & 0x7F {
                126 => {
                    let mut b = [0u8; 2];
                    self.fill(&mut b).await?;
                    u16::from_be_bytes(b) as usize
                }
                127 => {
                    let mut b = [0u8; 8];
                    self.fill(&mut b).await?;
                    u64::from_be_bytes(b) as usize
                }
                n => n as usize,
            };
            let mut mask = [0u8; 4];
            if masked {
                self.fill(&mut mask).await?;
            }
            let mut payload = vec![0u8; len];
            self.fill(&mut payload).await?;
            if masked {
                for (i, b) in payload.iter_mut().enumerate() {
                    *b ^= mask[i % 4];
                }
            }
            match opcode {
                0x1 => return Some(String::from_utf8_lossy(&payload).into_owned()),
                0x8 => return None,
                _ => continue,
            }
        }
    }

    /// Read the next frame as JSON, failing the test on timeout.
    pub async fn read_event(&mut self) -> serde_json::Value {
        let text = tokio::time::timeout(Duration::from_secs(2), self.read_text())
            .await
            .expect("timed out waiting for a ws frame")
            .expect("ws closed unexpectedly");
        serde_json::from_str(&text).expect("ws frame must be JSON")
    }

    /// Read frames until one with `type == wanted` arrives (bounded). The ceiling
    /// is generous because the `file:changed` path rides the `notify` backend,
    /// whose registration + event delivery latency balloons under the CPU
    /// contention of the full parallel workspace test run; fast events still
    /// return immediately.
    pub async fn wait_for(&mut self, wanted: &str) -> serde_json::Value {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            let text = tokio::time::timeout(remaining, self.read_text())
                .await
                .unwrap_or_else(|_| panic!("timed out waiting for `{wanted}`"))
                .expect("ws closed while waiting");
            let value: serde_json::Value = serde_json::from_str(&text).unwrap();
            if value.get("type").and_then(|t| t.as_str()) == Some(wanted) {
                return value;
            }
        }
    }

    /// Assert no frame with `type == unwanted` arrives within `window`.
    pub async fn assert_absent(&mut self, unwanted: &str, window: Duration) {
        let deadline = tokio::time::Instant::now() + window;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return;
            }
            match tokio::time::timeout(remaining, self.read_text()).await {
                Ok(Some(text)) => {
                    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
                    assert_ne!(
                        value.get("type").and_then(|t| t.as_str()),
                        Some(unwanted),
                        "unexpectedly received `{unwanted}`"
                    );
                }
                _ => return,
            }
        }
    }

    async fn next_byte(&mut self) -> Option<u8> {
        let mut b = [0u8; 1];
        self.stream.read_exact(&mut b).await.ok().map(|_| b[0])
    }

    async fn fill(&mut self, buf: &mut [u8]) -> Option<()> {
        self.stream.read_exact(buf).await.ok().map(|_| ())
    }
}
