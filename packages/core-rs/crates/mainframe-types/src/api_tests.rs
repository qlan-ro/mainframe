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
