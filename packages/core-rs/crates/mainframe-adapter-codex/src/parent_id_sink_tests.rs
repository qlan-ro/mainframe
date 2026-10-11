//! `ParentIdSink` must forward every `SessionSink` callback, including new ones
//! added after it was written (#284) — a silent drop here is a trap.

use mainframe_types::sync::LockExt as _;
use std::sync::Arc;

use mainframe_adapter_api::SessionSink;

use super::ParentIdSink;

use mainframe_adapter_api::test_support::RecordingSink;

#[test]
fn parent_id_sink_forwards_a_permission_cancellation() {
    let inner = Arc::new(RecordingSink::default());
    let wrapper = ParentIdSink::new(inner.clone(), "parent-1".to_string());

    wrapper.on_permission_cancelled("req_1");

    assert_eq!(*inner.cancelled.lock_recover(), vec!["req_1".to_string()]);
}
