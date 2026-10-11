//! The canonical daemon HTTP response envelope. The `ok`/`ok_empty`/`fail`
//! *constructors* live in `mainframe-server::routes::respond`; this module
//! holds the wire *shapes* only. Discrimination is on the boolean
//! `success` field, so the union types are `#[serde(untagged)]` with
//! `deny_unknown_fields` on the payload-free arms to keep the empty-ok and error
//! shapes unambiguous.

use serde::{Deserialize, Serialize};

/// Successful response carrying a payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApiOk<T> {
    pub success: bool,
    pub data: T,
}

/// Successful response with no payload (state-only mutations).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApiOkEmpty {
    pub success: bool,
}

/// Failed response. `error` is a human-readable message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApiErr {
    pub success: bool,
    pub error: String,
}

/// Canonical daemon HTTP response envelope for routes that return a payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ApiResponse<T> {
    Ok(ApiOk<T>),
    Err(ApiErr),
}

/// Envelope for state-only routes that reply via `ok_empty` (no `data`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ApiResponseEmpty {
    Ok(ApiOkEmpty),
    Err(ApiErr),
}

#[cfg(test)]
#[path = "api_tests.rs"]
mod tests;
