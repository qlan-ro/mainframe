//! Ported from `packages/types/src/api.ts`.
//!
//! The canonical daemon HTTP response envelope. The `ok`/`ok_empty`/`fail`
//! *constructors* live in `mainframe-server::routes::respond` (crate map §2.16);
//! this module ports the wire *shapes* only. Discrimination is on the boolean
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
mod tests {
    use super::*;
    use serde_json::{Value, json};

    /// Strip the fixture-only `_provenance` / `_route` keys.
    fn strip_meta(mut v: Value) -> Value {
        if let Some(obj) = v.as_object_mut() {
            obj.remove("_provenance");
            obj.remove("_route");
        }
        v
    }

    #[test]
    fn ok_with_payload_roundtrips() {
        let v = json!({ "success": true, "data": [1, 2, 3] });
        let parsed: ApiResponse<Vec<i64>> = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(parsed, ApiResponse::Ok(_)));
        assert_eq!(serde_json::to_value(&parsed).unwrap(), v);
    }

    #[test]
    fn err_roundtrips_and_is_not_ok() {
        let v = strip_meta(json!({
            "_provenance": "synthetic",
            "_route": "POST /api/chats/:id/messages",
            "success": false,
            "error": "Chat not found"
        }));
        let parsed: ApiResponse<Value> = serde_json::from_value(v.clone()).unwrap();
        assert!(matches!(parsed, ApiResponse::Err(_)));
        assert_eq!(serde_json::to_value(&parsed).unwrap(), v);
    }

    #[test]
    fn empty_ok_does_not_swallow_error() {
        // {success:true} → Ok
        let ok = strip_meta(json!({
            "_provenance": "synthetic",
            "_route": "POST /api/chats/:id/archive",
            "success": true
        }));
        let parsed: ApiResponseEmpty = serde_json::from_value(ok.clone()).unwrap();
        assert!(matches!(parsed, ApiResponseEmpty::Ok(_)));
        assert_eq!(serde_json::to_value(&parsed).unwrap(), ok);

        // {success:false,error} must NOT match the empty-ok arm (deny_unknown_fields).
        let err = json!({ "success": false, "error": "nope" });
        let parsed: ApiResponseEmpty = serde_json::from_value(err.clone()).unwrap();
        assert!(matches!(parsed, ApiResponseEmpty::Err(_)));
        assert_eq!(serde_json::to_value(&parsed).unwrap(), err);
    }
}

// PORT STATUS: packages/types/src/api.ts (18 lines)
// confidence: high
// todos: 0
// notes: Envelope shapes only; ok/ok_empty/fail constructors belong to
// mainframe-server::routes::respond. ApiResponse<T>/ApiResponseEmpty are
// untagged (discriminant is the boolean `success`); ApiOkEmpty/ApiErr carry
// deny_unknown_fields so an error body cannot be mis-read as an empty-ok. No
// cross-module deps.
