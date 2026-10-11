use super::*;

#[test]
fn daemon_target_serializes_null_token() {
    let json = r#"{"id":"local","kind":"local","label":"This Mac","baseUrl":"http://127.0.0.1:31415","token":null}"#;
    let t: DaemonTarget = serde_json::from_str(json).unwrap();
    assert_eq!(t.kind, DaemonKind::Local);
    assert!(t.token.is_none());
    assert_eq!(serde_json::to_string(&t).unwrap(), json);
}

#[test]
fn daemon_meta_omits_optionals_and_validates() {
    let json = r#"{"id":"remote-1","kind":"remote","label":"Server","host":"box.example:31415"}"#;
    let m: DaemonMeta = serde_json::from_str(json).unwrap();
    assert!(m.validate().is_ok());
    assert_eq!(serde_json::to_string(&m).unwrap(), json);
}

#[test]
fn daemon_meta_validate_rejects_empty_host() {
    let m = DaemonMeta {
        id: "x".to_string(),
        kind: DaemonKind::Local,
        label: "l".to_string(),
        host: String::new(),
        device: None,
        paired: None,
        scheme: None,
    };
    assert!(m.validate().is_err());
}

#[test]
fn daemon_meta_pre_change_shape_omits_scheme() {
    let json = r#"{"id":"remote-1","kind":"remote","label":"Server","host":"box.example:31415"}"#;
    let m: DaemonMeta = serde_json::from_str(json).unwrap();
    assert_eq!(m.scheme, None);
    assert_eq!(serde_json::to_string(&m).unwrap(), json);
}

#[test]
fn daemon_meta_round_trips_http_scheme() {
    let json = r#"{"id":"remote-1","kind":"remote","label":"Server","host":"127.0.0.1:31415","scheme":"http"}"#;
    let m: DaemonMeta = serde_json::from_str(json).unwrap();
    assert_eq!(m.scheme, Some(DaemonScheme::Http));
    assert_eq!(serde_json::to_string(&m).unwrap(), json);
}
