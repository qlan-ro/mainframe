//! Tests for `adapter.rs`, kept apart so that file stays under 300 lines.

use super::*;

#[test]
fn adapter_trait_resolves_a_plan_mode_handler() {
    assert!(Adapter::create_plan_mode_handler(&MockCliAdapter::default()).is_some());
}

#[test]
fn no_persistence_defaults_to_false() {
    assert!(!Adapter::capabilities(&MockCliAdapter::default()).no_persistence);
}

#[test]
fn with_no_persistence_reports_the_requested_value() {
    let adapter = MockCliAdapter::default().with_no_persistence(true);
    assert!(Adapter::capabilities(&adapter).no_persistence);
}

#[test]
fn fork_capability_and_pin_follow_the_constructor_flag() {
    let uncapable = MockCliAdapter::default();
    assert!(!Adapter::capabilities(&uncapable).fork);

    let capable = MockCliAdapter::default().with_fork_capable(true);
    assert!(Adapter::capabilities(&capable).fork);
}

fn pin_request(cut: Option<&str>) -> ForkPinRequest {
    ForkPinRequest {
        source_session_id: "sess-1".to_string(),
        cwd: "/tmp".to_string(),
        session_file_path: None,
        dest_dir: "/tmp/snap".to_string(),
        cut: cut.map(|id| mainframe_adapter_api::ForkCut {
            vendor_message_id: id.to_string(),
        }),
    }
}

#[tokio::test]
async fn pin_records_the_request_and_carries_the_cut() {
    let adapter = MockCliAdapter::default().with_fork_capable(true);
    let source = adapter
        .pin_fork_point(pin_request(Some("mock-history-4")))
        .await
        .unwrap();
    assert_eq!(source.last_turn_id.as_deref(), Some("mock-history-4"));
    assert_eq!(
        adapter.last_pin_request(),
        Some(pin_request(Some("mock-history-4")))
    );

    let whole = adapter.pin_fork_point(pin_request(None)).await.unwrap();
    assert_eq!(whole.last_turn_id, None);
}
