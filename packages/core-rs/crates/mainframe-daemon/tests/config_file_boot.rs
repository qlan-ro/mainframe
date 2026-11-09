//! Boots the real daemon binary: `config.json` is resolved from the process
//! env, which only a separate process can set.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use mainframe_runtime::test_support::poll_until;
use serde_json::{Value, json};
use tokio::process::{Child, Command};

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn spawn_daemon(data_dir: &Path) -> Child {
    Command::new(env!("CARGO_BIN_EXE_mainframe-daemon"))
        .env("MAINFRAME_DATA_DIR", data_dir)
        .env("NODE_ENV", "production")
        // Skips the login-shell probe.
        .env("E2E_MODE", "1")
        .env_remove("DAEMON_PORT")
        .env_remove("TUNNEL")
        .env_remove("TUNNEL_TOKEN")
        .env_remove("TUNNEL_URL")
        .env_remove("AUTH_TOKEN_SECRET")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap()
}

#[tokio::test]
async fn boot_restricts_the_file_and_stopping_with_clear_removes_tunnel_credentials() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    let port = free_port();
    std::fs::write(
        &path,
        json!({
            "port": port,
            "tunnel": false,
            "tunnelToken": "not-a-real-token",
            "tunnelUrl": "https://example.invalid",
            "authSecret": "kept",
            "futureKey": 1,
        })
        .to_string(),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

    let _daemon = spawn_daemon(dir.path());
    let client = mainframe_runtime::http::client().unwrap();
    let base = format!("http://127.0.0.1:{port}");
    poll_until(
        Duration::from_secs(30),
        Duration::from_millis(50),
        async || client.get(format!("{base}/health")).send().await.is_ok(),
    )
    .await
    .expect("daemon must start");
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );

    let response = client
        .post(format!("{base}/api/tunnel/stop"))
        .json(&json!({ "clearConfig": true }))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());

    let stored: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(
        stored,
        json!({ "port": port, "tunnel": false, "authSecret": "kept", "futureKey": 1 })
    );
}
