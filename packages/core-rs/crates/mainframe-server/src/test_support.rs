use axum::body::to_bytes;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum BodyJsonError {
    #[error(transparent)]
    Body(#[from] axum::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub async fn read_json(response: impl IntoResponse) -> Result<(StatusCode, Value), axum::Error> {
    let response = response.into_response();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await?;
    Ok((
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    ))
}

pub async fn body_json(response: impl IntoResponse) -> Result<(StatusCode, Value), BodyJsonError> {
    let response = response.into_response();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await?;
    Ok((status, serde_json::from_slice(&bytes)?))
}
