//! Boot integration for the launch, plugin, and LSP surfaces: serves `build_app` over a fully
//! wired `AppCtx` (launch registry + LSP manager + plugin manager Some) and asserts
//! the happy paths of `/api/projects/:id/launch/status`, `/api/plugins`, and
//! `/api/lsp/languages`.
//!
//! Integration tests are only built under `cargo test`, so `unwrap`/`expect` are
//! permitted here (RUST RULES `#[cfg(test)]` exemption).
#![allow(clippy::too_many_lines, reason = "Test assertions and scenarios")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

use axum::Router;
use mainframe_plugins::{PluginContext, PluginError};
use mainframe_server::{build_app, spawn_broadcast_pump};
use mainframe_types::plugin::PluginManifest;
use std::{net::SocketAddr, sync::Arc};

async fn demo_plugin(_ctx: Arc<PluginContext>) -> Result<Router<()>, PluginError> {
    Ok(Router::new())
}

fn manifest(id: &str) -> PluginManifest {
    PluginManifest {
        id: id.into(),
        name: id.into(),
        version: "1.0.0".into(),
        description: None,
        author: None,
        license: None,
        capabilities: vec![],
        ui: None,
        adapter: None,
        commands: None,
    }
}

#[tokio::test]
async fn boot_serves_launch_plugins_and_lsp_happy_paths() {
    let data_dir = tempfile::tempdir().unwrap();
    let config = mainframe_runtime::config::MainframeConfig {
        port: 0,
        data_dir: data_dir.path().to_string_lossy().into_owned(),
        tunnel: None,
        tunnel_url: None,
        tunnel_token: None,
        auth_secret: None,
    };
    let paths = mainframe_runtime::config::boot_paths(&config, data_dir.path());
    let daemon = mainframe_server::bootstrap::Bootstrap::new(
        config,
        paths,
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
        None,
        "test".into(),
    )
    .bind()
    .await
    .unwrap()
    .build()
    .await
    .unwrap();
    let ctx = daemon.ctx.clone();
    let project = ctx
        .core
        .db
        .call(|d| d.projects.create("/tmp/boot-routes-test", Some("Boot")))
        .await
        .unwrap();
    let project_id = project.id;
    ctx.infra
        .plugin_manager
        .load_builtin(manifest("demo"), data_dir.path().to_path_buf(), demo_plugin)
        .await
        .unwrap();
    spawn_broadcast_pump(Arc::clone(&ctx));

    let app = build_app(Arc::clone(&ctx));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        })
        .await
    });
    let base = format!("http://{addr}");

    // --- /api/projects/:id/launch/status ---
    let launch: serde_json::Value =
        reqwest::get(format!("{base}/api/projects/{project_id}/launch/status"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(launch["success"], true);
    assert_eq!(launch["data"]["effectivePath"], "/tmp/boot-routes-test");
    assert_eq!(launch["data"]["statuses"], serde_json::json!({}));

    // --- /api/plugins ---
    let plugins_resp = reqwest::get(format!("{base}/api/plugins")).await.unwrap();
    assert_eq!(plugins_resp.status(), reqwest::StatusCode::OK);
    let plugins: serde_json::Value = plugins_resp.json().await.unwrap();
    let list = plugins["plugins"].as_array().unwrap();
    assert!(
        list.iter().any(|p| p["id"] == "demo"),
        "expected the loaded builtin to be listed: {plugins}"
    );

    // --- /api/lsp/languages ---
    let lsp: serde_json::Value =
        reqwest::get(format!("{base}/api/lsp/languages?projectId={project_id}"))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(lsp["success"], true);
    assert!(
        lsp["data"]["languages"].is_array(),
        "languages must be an array: {lsp}"
    );

    // A missing projectId is a 400.
    let bad = reqwest::get(format!("{base}/api/lsp/languages"))
        .await
        .unwrap();
    assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);

    let _ = shutdown_tx.send(());
    server.await.unwrap().expect("server exits cleanly");
}
