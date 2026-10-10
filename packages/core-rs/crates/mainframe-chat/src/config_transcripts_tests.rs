//! `relocate_claude_transcripts`: every owned Claude session moves, Codex and
//! borrowed ones never do, and a deps impl without segments still moves the
//! active session.

use std::sync::{Arc, Mutex};

use mainframe_adapter_api::BoxFuture;
use mainframe_types::chat::Project;
use mainframe_types::events::DaemonEvent;

use super::*;
use crate::types::ActiveChat;

#[derive(Default)]
struct Deps {
    owned: Vec<OwnedNativeSession>,
    fail_on: Option<String>,
    moved: Mutex<Vec<String>>,
    paths: Mutex<Vec<(String, String)>>,
}

impl ConfigManagerDeps for Deps {
    fn get_active_chat(&self, _chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        None
    }
    fn chats_update(&self, _chat_id: &str, _updates: &mainframe_types::chat_patch::ChatPatch) {}
    fn projects_get(&self, _project_id: &str) -> Option<Project> {
        None
    }
    fn settings_get(&self, _ns: &str, _key: &str) -> Option<String> {
        None
    }
    fn emit_event(&self, _event: DaemonEvent) {}
    fn start_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn stop_chat<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn apply_tuning<'a>(&'a self, _chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn stop_launch_processes<'a>(
        &'a self,
        _project_id: &'a str,
        _project_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        None
    }
    fn take_starting_chat<'a>(&'a self, _chat_id: &'a str) -> Option<BoxFuture<'a, ()>> {
        None
    }
    fn owned_native_sessions(&self, _chat_id: &str) -> Vec<OwnedNativeSession> {
        self.owned.clone()
    }
    fn set_native_session_file_path(&self, native_ref: &str, path: &str) {
        let entry = (native_ref.to_string(), path.to_string());
        self.paths.lock().unwrap().push(entry);
    }
    fn move_claude_session_files<'a>(
        &'a self,
        session_id: &'a str,
        _old_dir: &'a str,
        _new_dir: &'a str,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            if self.fail_on.as_deref() == Some(session_id) {
                return Err("disk full".to_string());
            }
            self.moved.lock().unwrap().push(session_id.to_string());
            Ok(())
        })
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
    let active = relocate_claude_transcripts(&deps, "chat", codex_active(), "/p", "/wt")
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
    let path = relocate_claude_transcripts(&deps, "chat", active, "/p", "/wt")
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
    let path = relocate_claude_transcripts(&deps, "chat", active, "/p", "/wt")
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
    let err = relocate_claude_transcripts(&deps, "chat", codex_active(), "/p", "/wt")
        .await
        .unwrap_err();
    assert_eq!(err, "disk full");
    assert_eq!(deps.paths.lock().unwrap().len(), 1);
}
