use super::*;
use mainframe_types::adapter::{
    AdapterCapabilities, AdapterInfo, CatalogSource, ProviderQuota, ProviderQuotaStatus,
    QuotaWindow, QuotaWindowKind,
};

fn fallback_snapshot(id: &str, capabilities: AdapterCapabilities) -> AdapterInfo {
    AdapterInfo {
        id: id.to_string(),
        name: id.to_string(),
        description: format!("{id} adapter"),
        installed: true,
        version: None,
        models: vec![],
        models_revision: Some(1),
        catalog_source: Some(CatalogSource::Fallback),
        capabilities,
        fork_unavailable_reason: None,
    }
}

fn register_client(
    clients: &WsClients,
    id: &str,
    chats: &[&str],
) -> mpsc::UnboundedReceiver<String> {
    let (tx, rx) = mpsc::unbounded_channel::<String>();
    let subscriptions: Arc<Mutex<HashSet<String>>> =
        Arc::new(Mutex::new(chats.iter().map(|c| c.to_string()).collect()));
    clients.insert(id.to_string(), ClientHandle { tx, subscriptions });
    rx
}

fn quota_event() -> DaemonEvent {
    DaemonEvent::ProviderQuotaUpdated {
        adapter_id: "claude".into(),
        quota: ProviderQuota {
            status: ProviderQuotaStatus::Ok,
            observed_at: 1_700_000_000_000,
            model_windows: vec![],
            session: Some(QuotaWindow {
                kind: QuotaWindowKind::Session,
                used_percent: 55.0,
                resets_at: Some(1_700_010_000_000),
                observed_at: None,
                label: None,
            }),
            weekly: None,
            account_identity: Some("uuid-1".into()),
        },
    }
}

// An adapter whose catalog never left the fallback seed (so a
// `catalog_source == Probed` gate alone would skip it) still needs its
// capabilities replayed to a reconnecting client once `fork` is true.
#[test]
fn replays_fork_capability_for_a_fallback_catalog_adapter() {
    let caps = AdapterCapabilities {
        plan_mode: false,
        auto_mode: false,
        no_persistence: false,
        fork: true,
    };
    let snapshots = vec![fallback_snapshot("codex", caps)];
    let events = build_connect_replay_events(&snapshots);
    assert_eq!(
        events,
        vec![DaemonEvent::AdapterModelsUpdated {
            adapter_id: "codex".into(),
            models: vec![],
            models_revision: 1,
            installed: Some(true),
            capabilities: Some(caps),
            fork_unavailable_reason: None,
        }]
    );
}

// A fallback-catalog adapter with no fork signal (the common case) still
// produces no replay.
#[test]
fn skips_replay_for_a_fallback_catalog_adapter_with_no_fork_signal() {
    let caps = AdapterCapabilities {
        plan_mode: true,
        auto_mode: false,
        no_persistence: false,
        fork: false,
    };
    let snapshots = vec![fallback_snapshot("claude", caps)];
    assert!(build_connect_replay_events(&snapshots).is_empty());
}

// A fallback-catalog adapter with a known fork-unavailable reason (e.g. an
// old Codex CLI) also replays, so the UI's disabled-Fork reason
// survives a reconnect even before the catalog probe ever succeeds.
#[test]
fn replays_fork_unavailable_reason_for_a_fallback_catalog_adapter() {
    let caps = AdapterCapabilities {
        plan_mode: false,
        auto_mode: false,
        no_persistence: false,
        fork: false,
    };
    let mut snapshot = fallback_snapshot("codex", caps);
    snapshot.fork_unavailable_reason = Some("Codex CLI too old".into());
    let events = build_connect_replay_events(&[snapshot]);
    assert_eq!(events.len(), 1);
    match &events[0] {
        DaemonEvent::AdapterModelsUpdated {
            fork_unavailable_reason,
            ..
        } => {
            assert_eq!(
                fork_unavailable_reason.as_deref(),
                Some("Codex CLI too old")
            );
        }
        other => panic!("unexpected event: {other:?}"),
    }
}

// Seam-3 transport: a harvested quota carries no chatId, so the fan-out must
// reach every client account-wide — even one subscribed to no chat.
#[test]
fn delivers_provider_quota_updated_to_a_client_subscribed_to_no_chat() {
    let clients: WsClients = Arc::new(DashMap::new());
    let mut rx = register_client(&clients, "client-1", &[]);

    fanout(&clients, &quota_event());

    let payload = rx
        .try_recv()
        .expect("no-subscription client received the event");
    let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(value["type"], serde_json::json!("provider.quota.updated"));
    assert_eq!(value["adapterId"], serde_json::json!("claude"));
    assert_eq!(
        value["quota"]["session"]["usedPercent"],
        serde_json::json!(55.0)
    );
}

// `chat.offloaded` carries a `chatId` but must still reach a client
// that never subscribed to that chat — the renderer needs to drop the
// controller for a chat it isn't currently displaying.
#[test]
fn delivers_chat_offloaded_to_a_client_subscribed_to_no_chat() {
    let clients: WsClients = Arc::new(DashMap::new());
    let mut rx = register_client(&clients, "client-1", &[]);

    fanout(
        &clients,
        &DaemonEvent::ChatOffloaded {
            chat_id: "chat_1".to_string(),
        },
    );

    let payload = rx
        .try_recv()
        .expect("no-subscription client received chat.offloaded");
    let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(value["type"], serde_json::json!("chat.offloaded"));
    assert_eq!(value["chatId"], serde_json::json!("chat_1"));
}

/// A first-hop rule would trust a FORGED leftmost `x-forwarded-for` hop, so
/// a client could claim loopback (and skip auth entirely) by prepending
/// `127.0.0.1` ahead of its real address.
/// `trust_proxy_client_ip` walks the chain from the right instead, so the
/// real appended hop wins and a token is required.
#[tokio::test]
async fn a_forged_leftmost_forwarded_for_cannot_claim_loopback() {
    let mut ctx = Arc::try_unwrap(AppCtx::test_ctx()).unwrap_or_else(|_| unreachable!());
    ctx.core.auth_secret = Some("secret".to_string());
    let ctx = Arc::new(ctx);

    let peer: SocketAddr = "127.0.0.1:9999".parse().unwrap();
    let mut headers = HeaderMap::new();
    headers.insert("x-forwarded-for", "127.0.0.1, 203.0.113.7".parse().unwrap());

    let authed = authenticate_ws_upgrade(&ctx, &peer, &headers, None).await;
    assert!(
        !authed,
        "a forged leftmost 127.0.0.1 must not exempt the real client from auth"
    );
}
