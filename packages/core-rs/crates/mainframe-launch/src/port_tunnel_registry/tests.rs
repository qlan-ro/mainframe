use std::sync::Arc;
use std::time::Duration;

use tokio::time::sleep;

use super::{PortTunnelRegistry, PortTunnelScope, port_tunnel_label};
use crate::test_support::{
    spawn_count, write_counting_cloudflared, write_silent_cloudflared, write_slow_cloudflared,
};
use crate::tunnel_manager::{TunnelConfig, TunnelManager};

fn registry_with(bin: String) -> (Arc<TunnelManager>, Arc<PortTunnelRegistry>) {
    let config = TunnelConfig {
        cloudflared_bin: bin,
        dns_poll: Duration::from_millis(20),
        dns_timeout: Duration::from_millis(60),
        start_timeout: Duration::from_millis(3_000),
        ..TunnelConfig::default()
    };
    let manager = Arc::new(TunnelManager::with_config(None, config));
    let registry = Arc::new(PortTunnelRegistry::new(manager.clone()));
    (manager, registry)
}

fn scope(chat_id: &str) -> PortTunnelScope {
    PortTunnelScope {
        project_id: "proj-1".to_string(),
        chat_id: chat_id.to_string(),
    }
}

#[tokio::test]
async fn concurrent_starts_for_one_port_spawn_a_single_cloudflared() {
    let dir = tempfile::tempdir().unwrap();
    let (_manager, registry) = registry_with(write_counting_cloudflared(dir.path()));

    let (first, second) = tokio::join!(
        registry.start(5173, scope("chat-a")),
        registry.start(5173, scope("chat-b")),
    );

    assert_eq!(first.unwrap(), "https://abc-def1.trycloudflare.com");
    assert_eq!(second.unwrap(), "https://abc-def1.trycloudflare.com");
    assert_eq!(spawn_count(dir.path()), 1);
}

#[tokio::test]
async fn a_second_start_reuses_the_ready_tunnel() {
    let dir = tempfile::tempdir().unwrap();
    let (_manager, registry) = registry_with(write_counting_cloudflared(dir.path()));

    let first = registry.start(5173, scope("chat-a")).await.unwrap();
    let second = registry.start(5173, scope("chat-a")).await.unwrap();

    assert_eq!(first, "https://abc-def1.trycloudflare.com");
    assert_eq!(second, first);
    assert_eq!(spawn_count(dir.path()), 1);
}

#[tokio::test]
async fn a_ready_entry_the_manager_lost_is_restarted() {
    let dir = tempfile::tempdir().unwrap();
    let (manager, registry) = registry_with(write_counting_cloudflared(dir.path()));

    let first = registry.start(5173, scope("chat-a")).await.unwrap();
    manager.stop(&port_tunnel_label(5173)); // behind the registry's back
    let second = registry.start(5173, scope("chat-a")).await.unwrap();

    assert_eq!(first, "https://abc-def1.trycloudflare.com");
    assert_eq!(second, "https://abc-def2.trycloudflare.com");
    assert_eq!(spawn_count(dir.path()), 2);
}

#[tokio::test]
async fn list_prunes_a_ready_entry_the_manager_lost() {
    let dir = tempfile::tempdir().unwrap();
    let (manager, registry) = registry_with(write_counting_cloudflared(dir.path()));

    registry.start(5173, scope("chat-a")).await.unwrap();
    assert_eq!(registry.list().len(), 1);

    manager.stop(&port_tunnel_label(5173));

    assert_eq!(registry.list(), vec![]);
    assert_eq!(registry.entries_for_project("proj-1"), vec![]);
}

#[tokio::test]
async fn list_reports_a_ready_tunnel_with_its_url() {
    let dir = tempfile::tempdir().unwrap();
    let (_manager, registry) = registry_with(write_counting_cloudflared(dir.path()));

    registry.start(5173, scope("chat-a")).await.unwrap();

    let listed = registry.list();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].port, 5173);
    assert!(listed[0].ready);
    assert_eq!(
        listed[0].url.as_deref(),
        Some("https://abc-def1.trycloudflare.com")
    );
}

#[tokio::test]
async fn list_reports_a_mid_start_tunnel_without_a_url() {
    let dir = tempfile::tempdir().unwrap();
    let (_manager, registry) = registry_with(write_silent_cloudflared(dir.path()));

    let starting = tokio::spawn({
        let registry = registry.clone();
        async move { registry.start(5173, scope("chat-a")).await }
    });
    sleep(Duration::from_millis(100)).await;

    let listed = registry.list();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].port, 5173);
    assert!(!listed[0].ready);
    assert_eq!(listed[0].url, None);

    starting.abort();
}

#[tokio::test]
async fn stopping_an_unknown_or_already_stopped_port_is_a_no_op() {
    let dir = tempfile::tempdir().unwrap();
    let (_manager, registry) = registry_with(write_counting_cloudflared(dir.path()));

    registry.stop(5173);
    registry.start(5173, scope("chat-a")).await.unwrap();
    registry.stop(5173);
    registry.stop(5173);

    assert_eq!(registry.list(), vec![]);
}

#[tokio::test]
async fn stopping_a_mid_start_tunnel_cancels_it_once_it_resolves() {
    let dir = tempfile::tempdir().unwrap();
    let (manager, registry) = registry_with(write_slow_cloudflared(dir.path()));

    let starting = tokio::spawn({
        let registry = registry.clone();
        async move { registry.start(5173, scope("chat-a")).await }
    });
    sleep(Duration::from_millis(80)).await;
    registry.stop(5173);

    assert_eq!(
        starting.await.unwrap(),
        Err("Tunnel start cancelled".to_string())
    );
    assert_eq!(manager.get_url(&port_tunnel_label(5173)), None);
    assert_eq!(registry.list(), vec![]);
}

#[tokio::test]
async fn entries_for_project_reports_only_that_project_with_its_owning_chats() {
    let dir = tempfile::tempdir().unwrap();
    let (_manager, registry) = registry_with(write_counting_cloudflared(dir.path()));

    registry.start(5173, scope("chat-a")).await.unwrap();
    registry
        .start(
            5174,
            PortTunnelScope {
                project_id: "proj-2".to_string(),
                chat_id: "chat-b".to_string(),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        registry.entries_for_project("proj-1"),
        vec![(5173, "chat-a".to_string())]
    );
    assert_eq!(
        registry.entries_for_project("proj-2"),
        vec![(5174, "chat-b".to_string())]
    );
    assert_eq!(registry.entries_for_project("proj-3"), vec![]);
}

#[tokio::test]
async fn the_last_start_takes_ownership_of_the_tunnel() {
    let dir = tempfile::tempdir().unwrap();
    let (_manager, registry) = registry_with(write_counting_cloudflared(dir.path()));

    registry.start(5173, scope("chat-a")).await.unwrap();
    registry.start(5173, scope("chat-b")).await.unwrap();

    assert_eq!(
        registry.entries_for_project("proj-1"),
        vec![(5173, "chat-b".to_string())]
    );
    assert_eq!(spawn_count(dir.path()), 1);
}

#[tokio::test]
async fn a_failed_start_leaves_no_entry_behind() {
    let dir = tempfile::tempdir().unwrap();
    let (_manager, registry) =
        registry_with(dir.path().join("missing-cloudflared").display().to_string());

    assert!(registry.start(5173, scope("chat-a")).await.is_err());
    assert_eq!(registry.list(), vec![]);
}
