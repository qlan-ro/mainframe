use super::*;

use mainframe_services::quota::QuotaService;
use mainframe_types::adapter::{ProviderQuota, ProviderQuotaStatus, QuotaWindow, QuotaWindowKind};

use std::future::Future;

use std::pin::Pin;

fn blob(used_percent: f64) -> ProviderQuota {
    ProviderQuota {
        status: ProviderQuotaStatus::Ok,
        observed_at: 1_700_000_000_000,
        model_windows: vec![],
        session: Some(QuotaWindow {
            kind: QuotaWindowKind::Session,
            used_percent,
            resets_at: Some(1_700_010_000_000),
            observed_at: None,
            label: None,
        }),
        weekly: None,
        account_identity: Some("uuid-1".into()),
    }
}

/// A `{ get, refresh }` stand-in for the quota service.
struct FakeQuota {
    get_result: Option<ProviderQuota>,
    refresh_result: Option<ProviderQuota>,
}

impl QuotaService for FakeQuota {
    fn get(&self, _adapter_id: &str) -> Option<ProviderQuota> {
        self.get_result.clone()
    }
    fn refresh<'a>(
        &'a self,
        _adapter_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Option<ProviderQuota>> + Send + 'a>> {
        let out = self.refresh_result.clone();
        Box::pin(async move { out })
    }
}

fn with_quota(quota: Option<Arc<dyn QuotaService>>) -> Arc<AppCtx> {
    let mut ctx = AppCtx::test_ctx();
    if let Some(quota) = quota {
        Arc::get_mut(&mut ctx).unwrap().services.quota = quota;
    }
    ctx
}

use crate::test_support::body_json;

#[tokio::test]
async fn get_returns_the_merged_blob_in_the_ok_envelope() {
    let quota: Arc<dyn QuotaService> = Arc::new(FakeQuota {
        get_result: Some(blob(42.0)),
        refresh_result: None,
    });
    let ctx = with_quota(Some(quota));
    let (status, body) = body_json(get_quota(State(ctx), Path("claude".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], serde_json::json!(true));
    assert_eq!(
        body["data"]["session"]["usedPercent"],
        serde_json::json!(42.0)
    );
}

#[tokio::test]
async fn get_returns_empty_envelope_when_no_quota_is_known() {
    let quota: Arc<dyn QuotaService> = Arc::new(FakeQuota {
        get_result: None,
        refresh_result: None,
    });
    let ctx = with_quota(Some(quota));
    let (status, body) = body_json(get_quota(State(ctx), Path("claude".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!({ "success": true }));
}

#[tokio::test]
async fn get_rejects_an_id_with_illegal_characters() {
    let quota: Arc<dyn QuotaService> = Arc::new(FakeQuota {
        get_result: None,
        refresh_result: None,
    });
    let ctx = with_quota(Some(quota));
    // Axum has already percent-decoded `cla%20ude` into `cla ude` by here.
    let (status, body) = body_json(get_quota(State(ctx), Path("cla ude".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        serde_json::json!({"success":false,"error":"invalid provider id"})
    );
}

#[tokio::test]
async fn refresh_returns_the_updated_blob() {
    let quota: Arc<dyn QuotaService> = Arc::new(FakeQuota {
        get_result: None,
        refresh_result: Some(blob(77.0)),
    });
    let ctx = with_quota(Some(quota));
    let (status, body) = body_json(refresh_quota(State(ctx), Path("claude".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["data"]["session"]["usedPercent"],
        serde_json::json!(77.0)
    );
}

#[tokio::test]
async fn refresh_returns_empty_envelope_when_it_yields_no_blob() {
    let quota: Arc<dyn QuotaService> = Arc::new(FakeQuota {
        get_result: None,
        refresh_result: None,
    });
    let ctx = with_quota(Some(quota));
    let (status, body) = body_json(refresh_quota(State(ctx), Path("codex".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!({ "success": true }));
}

#[tokio::test]
async fn default_quota_service_returns_success_without_a_puller() {
    let ctx = with_quota(None);
    let (status, body) = body_json(refresh_quota(State(ctx), Path("claude".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!({"success":true}));
}
