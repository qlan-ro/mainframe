use super::*;

#[test]
fn platform_accepts_known_rejects_others() {
    assert_eq!(
        serde_json::from_str::<Platform>("\"macos\"").unwrap(),
        Platform::Macos
    );
    assert!(serde_json::from_str::<Platform>("\"freebsd\"").is_err());
}

#[test]
fn daemon_status_closed_vocabulary() {
    assert_eq!(
        serde_json::from_str::<DaemonStatus>("\"ready\"").unwrap(),
        DaemonStatus::Ready
    );
    assert!(serde_json::from_str::<DaemonStatus>("\"green\"").is_err());
}

#[test]
fn terminal_create_opts_requires_all_fields() {
    let json = r#"{"id":"t1","cwd":"/tmp","cols":80,"rows":24}"#;
    let opts: TerminalCreateOpts = serde_json::from_str(json).unwrap();
    assert!(opts.validate().is_ok());
    assert_eq!(serde_json::to_string(&opts).unwrap(), json);
    assert!(serde_json::from_str::<TerminalCreateOpts>(r#"{"id":"t1","cwd":"/tmp"}"#).is_err());
}

#[test]
fn terminal_create_opts_validate_rejects_nonpositive() {
    let opts = TerminalCreateOpts {
        id: "t1".to_string(),
        cwd: "/tmp".to_string(),
        cols: 0,
        rows: 24,
    };
    assert!(opts.validate().is_err());
}

#[test]
fn notify_body_optional() {
    assert_eq!(
        serde_json::to_string(&Notify {
            title: "hi".to_string(),
            body: None
        })
        .unwrap(),
        r#"{"title":"hi"}"#
    );
}

#[test]
fn log_record_rejects_unknown_level() {
    assert!(
        serde_json::from_str::<LogRecord>(r#"{"level":"verbose","module":"m","message":"msg"}"#)
            .is_err()
    );
    let ok: LogRecord =
        serde_json::from_str(r#"{"level":"info","module":"m","message":"msg"}"#).unwrap();
    assert_eq!(ok.level, LogLevel::Info);
}

#[test]
fn update_status_discriminated_on_state() {
    let json = r#"{"state":"downloading","percent":42.5}"#;
    let s: UpdateStatus = serde_json::from_str(json).unwrap();
    assert!(matches!(s, UpdateStatus::Downloading { .. }));
    assert_eq!(serde_json::to_string(&s).unwrap(), json);

    let na = r#"{"state":"not-available"}"#;
    let s: UpdateStatus = serde_json::from_str(na).unwrap();
    assert!(matches!(s, UpdateStatus::NotAvailable));
    assert_eq!(serde_json::to_string(&s).unwrap(), na);
}
