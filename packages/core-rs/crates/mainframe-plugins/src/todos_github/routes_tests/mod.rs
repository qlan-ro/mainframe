//! Route-level tests for the todos-plugin GitHub sub-router (todo #286, task
//! 18): the frozen wire shapes in the plan, the request-validation edge
//! cases, and the two cascades (`DELETE /link`, `DELETE /pairs/{todoId}`)
//! that must not reach the wrong tables. Split by route group to stay under
//! the 300-line file cap; this module holds the shared harness helpers.

mod cascades;
mod link;
mod pairs;
mod sync;

use std::collections::HashMap;
use std::sync::Arc;

use axum::body::to_bytes;
use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::Response;
use serde_json::Value;

use crate::todos_github::fake_github::FakeGitHub;
use crate::todos_github::test_support::{self, Harness};

async fn read(resp: Response) -> (StatusCode, Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn qs(pairs: &[(&str, &str)]) -> Query<HashMap<String, String>> {
    Query(
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    )
}

async fn setup(github: FakeGitHub) -> Harness {
    test_support::setup(Arc::new(github)).await
}
