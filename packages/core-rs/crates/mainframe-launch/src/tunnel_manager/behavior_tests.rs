use super::*;
#[test]
fn cloudflared_command_carries_the_resolved_path() {
    let cmd = build_cloudflared_command(
        "cloudflared",
        &["tunnel".to_string()],
        Some("/opt/homebrew/bin:/usr/bin"),
    );
    let path = cmd
        .as_std()
        .get_envs()
        .find(|(k, _)| *k == std::ffi::OsStr::new("PATH"))
        .and_then(|(_, v)| v)
        .map(|v| v.to_string_lossy().into_owned());
    assert_eq!(path.as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
}
#[test]
fn parse_url_extracts_from_a_log_line() {
    let line = "2024-01-01T00:00:00Z INF | Your quick Tunnel has been created! Visit it at:  https://abc-def-ghi.trycloudflare.com";
    assert_eq!(
        TunnelManager::parse_url(line).as_deref(),
        Some("https://abc-def-ghi.trycloudflare.com")
    );
}
#[test]
fn parse_url_extracts_from_a_plain_line() {
    let line = "https://some-tunnel-name.trycloudflare.com";
    assert_eq!(
        TunnelManager::parse_url(line).as_deref(),
        Some("https://some-tunnel-name.trycloudflare.com")
    );
}
#[test]
fn parse_url_returns_none_when_absent() {
    assert_eq!(TunnelManager::parse_url("2024 INF Starting tunnel"), None);
}
#[test]
fn parse_url_returns_none_for_http() {
    assert_eq!(
        TunnelManager::parse_url("http://abc-def.trycloudflare.com"),
        None
    );
}
#[test]
fn parse_url_returns_none_for_a_different_domain() {
    assert_eq!(
        TunnelManager::parse_url("https://example.cloudflare.com"),
        None
    );
}
#[test]
fn parse_url_returns_none_for_empty_string() {
    assert_eq!(TunnelManager::parse_url(""), None);
}
#[tokio::test]
async fn get_url_returns_none_for_unknown_label() {
    let manager = TunnelManager::new(None);
    assert_eq!(manager.get_url("daemon"), None);
    assert_eq!(manager.get_url("preview:Dev Server"), None);
}
#[tokio::test]
async fn stop_is_a_no_op_for_unknown_label() {
    let manager = TunnelManager::new(None);
    manager.stop("nonexistent").await; // must not panic
}
#[tokio::test]
async fn stop_all_is_a_no_op_when_no_tunnels_running() {
    let manager = TunnelManager::new(None);
    manager.stop_all().await; // must not panic
}
#[tokio::test]
async fn broadcasts_stopped_when_stop_called_for_a_running_tunnel() {
    let (broadcast, events) = recorder();
    let manager = TunnelManager::new(Some(broadcast));
    manager.tunnels.insert(
        "daemon".to_string(),
        ManagedTunnel {
            process: TunnelProcess::exited_for_test(),
            url: "https://test.trycloudflare.com".to_string(),
            ready: true,
        },
    );
    events.lock().unwrap().clear();
    manager.stop("daemon").await;
    let evs = events.lock().unwrap();
    assert_eq!(evs.len(), 1);
    assert!(matches!(
        &evs[0],
        DaemonEvent::TunnelStatus { state: TunnelState::Stopped, label, .. } if label == "daemon"
    ));
}
#[tokio::test]
async fn does_not_broadcast_when_stop_called_for_unknown_label() {
    let (broadcast, events) = recorder();
    let manager = TunnelManager::new(Some(broadcast));
    manager.stop("nonexistent").await;
    assert!(events.lock().unwrap().is_empty());
}
#[tokio::test]
async fn works_without_a_broadcast_callback() {
    let manager = TunnelManager::new(None);
    manager.stop("nonexistent").await; // must not panic
}
#[tokio::test]
async fn verify_false_when_no_tunnel() {
    let manager = TunnelManager::new(None);
    assert!(!manager.verify("daemon").await);
}
#[tokio::test]
async fn verify_false_when_not_ready_without_fetching() {
    let (base, hits) = serve_canned("200 OK", "{\"status\":\"ok\"}").await;
    let manager = TunnelManager::new(None);
    manager.tunnels.insert(
        "daemon".to_string(),
        ManagedTunnel {
            process: TunnelProcess::exited_for_test(),
            url: base,
            ready: false,
        },
    );
    assert!(!manager.verify("daemon").await);
    assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 0);
}
#[tokio::test]
async fn verify_true_when_health_is_200_and_status_ok() {
    let (base, _hits) = serve_canned("200 OK", "{\"status\":\"ok\"}").await;
    let manager = TunnelManager::new(None);
    insert_ready(&manager, "daemon", &base);
    assert!(manager.verify("daemon").await);
}
#[tokio::test]
async fn verify_false_on_network_error() {
    // Point at a closed port (nothing listening) → reqwest connect error.
    let manager = TunnelManager::new(None);
    insert_ready(&manager, "daemon", "http://127.0.0.1:1");
    assert!(!manager.verify("daemon").await);
}
#[tokio::test]
async fn verify_false_on_non_200() {
    let (base, _hits) = serve_canned("502 Bad Gateway", "Bad Gateway").await;
    let manager = TunnelManager::new(None);
    insert_ready(&manager, "daemon", &base);
    assert!(!manager.verify("daemon").await);
}
#[tokio::test]
async fn verify_false_when_body_status_not_ok() {
    let (base, _hits) = serve_canned("200 OK", "{\"status\":\"error\"}").await;
    let manager = TunnelManager::new(None);
    insert_ready(&manager, "daemon", &base);
    assert!(!manager.verify("daemon").await);
}
#[tokio::test]
async fn verify_caches_success_within_ttl() {
    let (base, hits) = serve_canned("200 OK", "{\"status\":\"ok\"}").await;
    let manager = TunnelManager::new(None);
    insert_ready(&manager, "daemon", &base);
    assert!(manager.verify("daemon").await);
    assert!(manager.verify("daemon").await);
    assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
}
#[tokio::test]
async fn verify_refetches_after_cache_ttl() {
    let (base, hits) = serve_canned("200 OK", "{\"status\":\"ok\"}").await;
    let config = TunnelConfig {
        verify_cache_ttl: Duration::from_millis(30),
        ..TunnelConfig::default()
    };
    let manager = TunnelManager::with_config(None, config);
    insert_ready(&manager, "daemon", &base);
    assert!(manager.verify("daemon").await);
    assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
    sleep(Duration::from_millis(50)).await;
    assert!(manager.verify("daemon").await);
    assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 2);
}
#[tokio::test]
async fn tunnel_survives_continued_child_logging_after_start_resolves() {
    let dir = tempfile::tempdir().unwrap();
    let bin = write_chatty_cloudflared(dir.path());
    let (broadcast, events) = recorder();
    let config = TunnelConfig {
        cloudflared_bin: bin,
        dns_poll: Duration::from_millis(20),
        dns_timeout: Duration::from_millis(100),
        ..TunnelConfig::default()
    };
    let manager = TunnelManager::with_config(Some(broadcast), config);

    let url = manager.start(3000, "daemon", None).await.unwrap();
    assert_eq!(url, "https://abc-def.trycloudflare.com");

    // Long enough for several post-ready log writes: with the pipes closed
    // the child dies on SIGPIPE and the exit watcher removes the tunnel.
    sleep(Duration::from_millis(400)).await;
    assert_eq!(
        manager.get_url("daemon").as_deref(),
        Some("https://abc-def.trycloudflare.com")
    );
    assert_eq!(stopped_broadcasts(&events), 0);
    manager.stop("daemon").await;
}
#[tokio::test]
async fn start_resolves_with_url_when_dns_outlasts_the_start_timeout() {
    let dir = tempfile::tempdir().unwrap();
    let bin = write_fake_cloudflared(dir.path());
    let (broadcast, events) = recorder();
    // start_timeout is short, but must NOT fire once connected; DNS never
    // resolves (fake host) so the grace path resolves with the URL anyway.
    let config = TunnelConfig {
        cloudflared_bin: bin,
        start_timeout: Duration::from_millis(3_000),
        dns_poll: Duration::from_millis(20),
        dns_timeout: Duration::from_millis(150),
        ..TunnelConfig::default()
    };
    let manager = TunnelManager::with_config(Some(broadcast), config);

    let url = manager.start(3000, "daemon", None).await.unwrap();
    assert_eq!(url, "https://abc-def.trycloudflare.com");

    // A dns_verified{dnsVerified:false} status was broadcast (grace path).
    {
        let evs = events.lock().unwrap();
        assert!(evs.iter().any(|e| matches!(
            e,
            DaemonEvent::TunnelStatus {
                state: TunnelState::DnsVerified,
                dns_verified: Some(false),
                ..
            }
        )));
    }

    // Tunnel is registered and marked ready; clean up the sleeping child.
    assert_eq!(
        manager.get_url("daemon").as_deref(),
        Some("https://abc-def.trycloudflare.com")
    );
    manager.stop("daemon").await;
    // stop() reports the tunnel it stopped; the exit watcher stays quiet.
    sleep(Duration::from_millis(50)).await;
    assert_eq!(stopped_broadcasts(&events), 1);
}
#[test]
fn record_entry_records_with_the_absolute_binary_path() {
    let entry = tunnel_record_entry("/abs/bin/cloudflared", Some(4242), "preview:Dev").unwrap();
    assert_eq!(entry.pid, 4242);
    assert_eq!(entry.kind, ManagedChildKind::Tunnel);
    assert_eq!(entry.command, "/abs/bin/cloudflared");
    assert_eq!(entry.label, "preview:Dev");
    assert!(!entry.group);
    assert_eq!(entry.cwd, None);
}
#[test]
fn record_entry_none_when_the_cloudflared_path_is_a_bare_name() {
    assert!(tunnel_record_entry("cloudflared", Some(4242), "preview:Dev").is_none());
}
#[test]
fn record_entry_none_when_the_child_has_no_pid() {
    assert!(tunnel_record_entry("/abs/bin/cloudflared", None, "preview:Dev").is_none());
}
