//! `GET /api/projects/{id}/automation-recommendations` — fingerprints the
//! registered project and maps the result through the Setup Advisor rules
//! dataset. Mirrors `routes/suggestions.rs`'s handler shape.

use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::{Path as AxPath, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::get;
use mainframe_types::setup_advisor::{ProjectFingerprint, SetupAdvisorReport};

use crate::ctx::AppCtx;
use crate::respond::{fail, ok};
use crate::routes::files::resolve_base;
use crate::setup_advisor;

/// How long the fingerprint gets before the request gives up on it. The scan
/// walks a directory tree the daemon does not control, so its cost is the
/// repository's to decide; without a ceiling one project holds a request open
/// indefinitely and the caller has nothing to show for the wait.
const FINGERPRINT_BUDGET: Duration = Duration::from_secs(15);

async fn handle_automation_recommendations(ctx: &AppCtx, id: &str) -> Response {
    let base_path = match resolve_base(ctx, id, None).await {
        Ok(b) => b,
        Err(resp) => return resp,
    };

    let is_dir = tokio::fs::metadata(&base_path)
        .await
        .is_ok_and(|meta| meta.is_dir());
    if !is_dir {
        return fail(StatusCode::NOT_FOUND, "Project path not found");
    }

    let scan = setup_advisor::fingerprint(Path::new(&base_path));
    match build_report(scan, &base_path, FINGERPRINT_BUDGET).await {
        Some(report) => ok(report),
        None => fail(
            StatusCode::GATEWAY_TIMEOUT,
            "Scanning the project took too long",
        ),
    }
}

/// Maps a fingerprint scan through the rules dataset, or `None` when the scan
/// outlasts `budget`. Takes the scan as a future so a test can hand it one that
/// never finishes — a real scan of a small project is too fast to time out.
async fn build_report(
    scan: impl Future<Output = ProjectFingerprint>,
    base_path: &str,
    budget: Duration,
) -> Option<SetupAdvisorReport> {
    let fingerprint = match tokio::time::timeout(budget, scan).await {
        Ok(fingerprint) => fingerprint,
        Err(_) => {
            tracing::warn!(
                base_path,
                budget_secs = budget.as_secs(),
                "setup advisor: fingerprint exceeded its time budget"
            );
            return None;
        }
    };
    let recommendations = setup_advisor::recommend(&fingerprint);
    Some(SetupAdvisorReport {
        fingerprint,
        recommendations,
    })
}

async fn get_automation_recommendations(
    State(ctx): State<Arc<AppCtx>>,
    AxPath(id): AxPath<String>,
) -> Response {
    handle_automation_recommendations(&ctx, &id).await
}

pub fn router() -> Router<Arc<AppCtx>> {
    Router::new().route(
        "/api/projects/{id}/automation-recommendations",
        get(get_automation_recommendations),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_scan_that_outlasts_its_budget_yields_no_report() {
        let never_finishes = std::future::pending::<ProjectFingerprint>();

        let report = build_report(never_finishes, "/tmp/slow-project", Duration::ZERO).await;

        assert!(report.is_none());
    }

    #[tokio::test]
    async fn a_scan_within_its_budget_yields_the_report() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("package.json"),
            r#"{ "dependencies": { "react": "18.2.0" } }"#,
        )
        .unwrap();

        let scan = setup_advisor::fingerprint(project.path());
        let report = build_report(scan, &project.path().to_string_lossy(), FINGERPRINT_BUDGET)
            .await
            .expect("the scan of a one-file project fit in the budget");

        assert!(report.fingerprint.frameworks.contains(&"react".to_string()));
        assert!(!report.recommendations.is_empty());
    }
}
