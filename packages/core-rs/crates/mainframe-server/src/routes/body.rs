use crate::input_error::InputError;
use axum::{
    body::Bytes,
    extract::{FromRequest, Request, rejection::BytesRejection},
};
use serde::de::DeserializeOwned;

pub(crate) fn parse_body<T: DeserializeOwned>(body: &[u8]) -> Option<T> {
    let bytes = if body.iter().all(u8::is_ascii_whitespace) {
        b"{}"
    } else {
        body
    };
    serde_json::from_slice(bytes).ok()
}

pub(crate) fn parse_json_body<T: DeserializeOwned>(body: &[u8]) -> Result<T, InputError> {
    Ok(serde_json::from_slice(body)?)
}

pub(crate) struct RequestJson<T>(pub Result<T, InputError>);

impl<T: DeserializeOwned> RequestJson<T> {
    pub(crate) fn from_bytes(bytes: impl AsRef<[u8]>) -> Self {
        Self(parse_body(bytes.as_ref()).ok_or(InputError::Rejected("Invalid request body")))
    }
}

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for RequestJson<T> {
    type Rejection = BytesRejection;
    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        let bytes = Bytes::from_request(request, state).await?;
        Ok(Self::from_bytes(bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_and_malformed_bodies_keep_each_routes_policy() {
        assert_eq!(
            parse_body::<serde_json::Value>(b" \n"),
            Some(serde_json::json!({}))
        );
        assert!(parse_json_body::<serde_json::Value>(b" \n").is_err());
        assert!(parse_body::<serde_json::Value>(b"{").is_none());
        assert!(
            RequestJson::<serde_json::Value>::from_bytes(b"{")
                .0
                .is_err()
        );
    }
}
