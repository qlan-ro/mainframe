//! `relocate_claude_transcripts`: every owned Claude session moves, Codex and
//! borrowed ones never do, and a deps impl without segments still moves the
//! active session.

use std::sync::{Arc, Mutex};

use super::*;

#[derive(Default)]
struct Deps {
    owned: Vec<OwnedNativeSession>,
    fail_on: Option<String>,
    moved: Arc<Mutex<Vec<String>>>,
    paths: Arc<Mutex<Vec<(String, String)>>>,
}

impl Deps {
    fn build(&self) -> crate::test_support::FakeDeps {
        let mut deps = crate::test_support::FakeDeps::default();
        *deps.store.owned_sessions.lock().unwrap() = self.owned.clone();
        *deps.workspace.move_fail_session.lock().unwrap() = self.fail_on.clone();
        deps.workspace.moved_sessions = self.moved.clone();
        deps.store.native_paths = self.paths.clone();
        deps
    }
}

fn owned(native_ref: &str, adapter: &str, session: &str) -> OwnedNativeSession {
    OwnedNativeSession {
        native_ref: native_ref.into(),
        adapter_id: adapter.into(),
        session_id: session.into(),
    }
}

fn codex_active() -> ActiveSession<'static> {
    ActiveSession {
        adapter_id: "codex",
        session_id: Some("x-1"),
    }
}

#[tokio::test]
async fn every_owned_claude_session_moves_and_records_its_path() {
    let deps = Deps {
        owned: vec![
            owned("ns_c1", "claude", "c-1"),
            owned("ns_x", "codex", "x-1"),
            owned("ns_c2", "claude", "c-2"),
        ],
        ..Default::default()
    };
    let active = relocate_claude_transcripts(&deps.build(), "chat", codex_active(), "/p", "/wt")
        .await
        .unwrap();
    assert_eq!(*deps.moved.lock().unwrap(), ["c-1", "c-2"]);
    let paths = deps.paths.lock().unwrap().clone();
    assert_eq!(paths.len(), 2);
    assert_eq!(paths[0].0, "ns_c1");
    assert_eq!(paths[0].1, compute_session_file_path("/wt", "c-1"));
    // The active session is Codex: nothing for the mirror to change.
    assert_eq!(active, None);
}

#[tokio::test]
async fn the_active_claude_session_path_is_returned() {
    let deps = Deps {
        owned: vec![owned("ns_c", "claude", "c-1")],
        ..Default::default()
    };
    let active = ActiveSession {
        adapter_id: "claude",
        session_id: Some("c-1"),
    };
    let path = relocate_claude_transcripts(&deps.build(), "chat", active, "/p", "/wt")
        .await
        .unwrap();
    assert_eq!(path, Some(compute_session_file_path("/wt", "c-1")));
}

#[tokio::test]
async fn without_segments_the_active_session_moves_as_before() {
    let deps = Deps::default();
    let active = ActiveSession {
        adapter_id: "claude",
        session_id: Some("c-1"),
    };
    let path = relocate_claude_transcripts(&deps.build(), "chat", active, "/p", "/wt")
        .await
        .unwrap();
    assert_eq!(*deps.moved.lock().unwrap(), ["c-1"]);
    assert!(deps.paths.lock().unwrap().is_empty());
    assert_eq!(path, Some(compute_session_file_path("/wt", "c-1")));
}

#[tokio::test]
async fn a_failed_move_stops_and_keeps_earlier_paths() {
    let deps = Deps {
        owned: vec![
            owned("ns_c1", "claude", "c-1"),
            owned("ns_c2", "claude", "c-2"),
        ],
        fail_on: Some("c-2".into()),
        ..Default::default()
    };
    let err = relocate_claude_transcripts(&deps.build(), "chat", codex_active(), "/p", "/wt")
        .await
        .unwrap_err();
    assert_eq!(err.to_string(), "disk full");
    assert_eq!(deps.paths.lock().unwrap().len(), 1);
}
