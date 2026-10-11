use super::*;
use crate::message_cache::timing_tests::{result, tool};

#[test]
fn tool_timing_store_keeps_first_start_and_terminal_completion() {
    let mut store = ToolTimingStore::default();
    store.observe("s", &[tool("a")], 1000);
    store.observe("s", &[tool("b")], 1100);
    store.observe("s", &[result("a", false)], 1200);
    store.observe("s", &[result("b", true)], 1300);
    store.observe(
        "s",
        &[tool("a"), result("a", false), tool("b"), result("b", true)],
        9000,
    );
    assert_eq!(
        store.calls["a"].timing,
        Some(ToolCallTiming {
            started_at: 1000,
            completed_at: Some(1200)
        })
    );
    assert_eq!(
        store.calls["b"].timing,
        Some(ToolCallTiming {
            started_at: 1100,
            completed_at: Some(1300)
        })
    );
}

#[test]
fn tool_timing_store_preserves_source_order_without_inventing_starts() {
    let mut store = ToolTimingStore::default();
    store.observe(
        "s",
        &[
            result("early", false),
            tool("early"),
            tool("normal"),
            result("normal", false),
        ],
        1000,
    );
    assert_eq!(store.calls["early"].timing, None);
    assert_eq!(
        store.calls["normal"].timing,
        Some(ToolCallTiming {
            started_at: 1000,
            completed_at: Some(1000)
        })
    );
    store.observe("s", &[tool("early")], 9000);
    assert_eq!(store.calls["early"].timing, None);
}

#[test]
fn tool_timing_store_clamps_backwards_clock_and_guards_session_ownership() {
    let mut store = ToolTimingStore::default();
    store.observe("new", &[tool("a")], 1000);
    store.observe("old", &[result("a", false)], 1100);
    assert!(!store.finish_session("old", 1200));
    assert_eq!(store.calls["a"].timing.unwrap().completed_at, None);
    assert!(store.finish_session("new", 900));
    assert_eq!(store.calls["a"].timing.unwrap().completed_at, Some(1000));
    assert!(!store.finish_session("new", 9000));
}
