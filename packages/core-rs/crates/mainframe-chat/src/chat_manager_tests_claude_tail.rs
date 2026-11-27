//! A real Claude transcript opened through its tail window and then loaded in
//! full, as a resume does: the full load must find the window it served held
//! up, and send no resync (`chat_manager/adapter_window.rs`).
use super::*;
use crate::test_support::test_chat;
use mainframe_adapter_api::{Adapter, AdapterSession};
use mainframe_types::display::DisplayMessageType;
use serde_json::{Value, json};
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};

const SESSION: &str = "tail-session";
const TURNS: usize = 150;

#[derive(Default)]
struct Resyncs(AtomicUsize);
impl crate::chat_surface::ChatSurface for Resyncs {
    fn on_chat_surface_event(&self, event: crate::chat_surface::ChatSurfaceEvent) {
        if matches!(event, crate::chat_surface::ChatSurfaceEvent::Resync { .. }) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
}

struct Writer {
    out: std::io::BufWriter<std::fs::File>,
    parent: Option<String>,
    n: usize,
}

impl Writer {
    fn line(&mut self, kind: &str, prompt: bool, mut body: Value) {
        self.n += 1;
        let uuid = format!("{kind}{}", self.n);
        let mut entry = json!({
            "type": if kind == "a" { "assistant" } else { "user" },
            "uuid": uuid, "sessionId": SESSION, "parentUuid": self.parent,
            "timestamp": format!("2026-11-01T00:{:02}:{:02}Z", (self.n / 60) % 60, self.n % 60),
        });
        if prompt {
            entry["promptId"] = json!(format!("prompt-{}", self.n));
        }
        for (key, value) in body.as_object_mut().unwrap().iter() {
            entry[key] = value.clone();
        }
        self.parent = Some(uuid);
        writeln!(self.out, "{entry}").unwrap();
    }

    fn user(&mut self, text: &str) {
        self.line("u", true, json!({"message": {"role": "user", "content": text}}));
    }

    fn reply(&mut self, text: &str) {
        let id = format!("msg-{}", self.n);
        self.line("a", false, json!({"message": {"id": id, "role": "assistant",
            "stop_reason": "end_turn", "content": [{"type": "text", "text": text}]}}));
    }

    fn call(&mut self, id: &str, name: &str, input: Value) {
        self.line("a", false, json!({"message": {"id": format!("msg-{id}"), "role": "assistant",
            "stop_reason": "tool_use",
            "content": [{"type": "tool_use", "id": id, "name": name, "input": input}]}}));
    }

    fn result(&mut self, id: &str, text: &str) {
        self.line("r", false, json!({"message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": id, "content": text}]}}));
    }
}

enum Shape {
    Plain,
    /// A compaction boundary near the start, long before any window.
    IdleCompacted,
    /// A compaction boundary three turns from the end, inside any window.
    IdleInWindow,
    /// A task created in the first turn and updated in the last.
    TaskAcrossCut,
}

/// About 10 MB: `TURNS` turns, each a prompt, a tool call with a 64 KB result, a reply.
fn transcript(path: &std::path::Path, shape: &Shape) {
    let mut w = Writer {
        out: std::io::BufWriter::new(std::fs::File::create(path).unwrap()),
        parent: None,
        n: 0,
    };
    let blob = "lorem ipsum dolor sit amet ".repeat(2400);
    for turn in 0..TURNS {
        w.user(&format!("question {turn}"));
        if turn == 0 && matches!(shape, Shape::TaskAcrossCut) {
            {
                w.call("create", "TaskCreate", json!({"subject": "Write the plan"}));
                w.result("create", "Task #1 created successfully");
            }
        }
        if (turn == 1 && matches!(shape, Shape::IdleCompacted))
            || (turn == TURNS - 3 && matches!(shape, Shape::IdleInWindow))
        {
            {
                w.line("s", false, json!({"type": "system", "subtype": "compact_boundary",
                    "uuid": "boundary", "content": "Conversation compacted"}));
                w.parent = Some("boundary".into());
            }
        }
        let id = format!("toolu_{turn}");
        w.call(&id, "Bash", json!({"command": "ls"}));
        w.result(&id, &blob);
        if turn == TURNS - 1 && matches!(shape, Shape::TaskAcrossCut) {
            {
                w.call("update", "TaskUpdate", json!({"taskId": "1", "status": "completed"}));
                w.result("update", "Updated task #1 status");
            }
        }
        w.reply(&format!("answer {turn}"));
    }
    w.out.flush().unwrap();
}

fn user_count(messages: &[mainframe_types::display::DisplayMessage]) -> usize {
    messages
        .iter()
        .filter(|m| m.r#type == DisplayMessageType::User)
        .count()
}

/// Opens the chat through its tail window, then loads it in full. The
/// window (`None` when the adapter fell back) and the number of resyncs.
async fn open(shape: Shape, idle_marker: bool) -> (Option<(Vec<mainframe_types::display::DisplayMessage>, bool)>, usize) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(format!("{SESSION}.jsonl"));
    transcript(&path, &shape);
    let session: Arc<dyn AdapterSession> =
        mainframe_adapter_claude::adapter::ClaudeAdapter::default().create_session(
            mainframe_types::adapter::SessionOptions {
                project_path: dir.path().to_string_lossy().into_owned(),
                chat_id: Some(SESSION.into()),
                session_file_path: Some(path.to_string_lossy().into_owned()),
                mainframe_chat_id: "c1".into(),
                fork_source: None,
            },
        );
    let mut chat = test_chat("c1");
    chat.vendor_session_id = Some(SESSION.into());
    chat.session_file_path = Some(path.to_string_lossy().into_owned());
    let deps = FakeDeps::with_chats(vec![chat]);
    *deps.adapters.session_to_return.lock().unwrap() = Some(session);
    deps.adapters.real_display.store(true, Ordering::SeqCst);
    if idle_marker {
        let db = mainframe_db::actor::SqliteActor::spawn(|| {
            let d = mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:"))?;
            let sql = |q: &str| d.connection().execute(q, []).map(|_| ());
            sql("INSERT INTO projects(id,name,path,created_at,last_opened_at) VALUES ('p1','p','/p','','')")?;
            sql("INSERT INTO chats(id,project_id,adapter_id,status,created_at,updated_at) VALUES ('c1','p1','claude','active','','')")?;
            let meta = json!({"origin": "idle", "requestId": "request", "sessionGeneration": "g",
                "vendorId": "boundary"});
            d.connection().execute(
                "INSERT INTO idle_compaction_provenance(chat_id,request_id,metadata,created_at) VALUES ('c1','request',?1,'2026-11-26T00:00:00Z')",
                [meta.to_string()],
            )?;
            Ok(d)
        })
        .unwrap();
        assert!(deps.store.idle_db.set(db).is_ok());
    }
    let surface = Arc::new(Resyncs::default());
    let manager = ChatManager::new(deps).with_chat_surface(surface.clone());
    let window = manager
        .adapter_first_window_by("c1", 16, &|messages| user_count(messages) >= 10)
        .await
        .map(|window| (window.messages, window.has_older));
    manager.load_chat("c1").await;
    (window, surface.0.load(Ordering::SeqCst))
}

#[tokio::test]
async fn a_plain_tail_window_holds_up_against_the_full_load() {
    let (window, resyncs) = open(Shape::Plain, false).await;
    let (messages, older) = window.expect("the tail serves the first window");
    assert!(older);
    assert!(user_count(&messages) >= 10);
    assert_eq!(resyncs, 0);
}

#[tokio::test]
async fn an_idle_compacted_chat_opens_without_a_resync() {
    let (window, resyncs) = open(Shape::IdleCompacted, true).await;
    let (messages, _) = window.expect("the tail serves the first window");
    assert!(
        messages.iter().all(|m| m.id != "request"),
        "the marker belongs before the window, not in it"
    );
    assert_eq!(resyncs, 0);
}

#[tokio::test]
async fn a_task_update_whose_creation_is_before_the_cut_takes_the_full_read() {
    // The cold full load that follows is the baseline, not a window's resync.
    let (window, _) = open(Shape::TaskAcrossCut, false).await;
    assert!(window.is_none(), "the subject cannot be told from the tail");
}

#[tokio::test]
async fn a_marker_whose_boundary_is_inside_the_window_shows_there_without_a_resync() {
    let (window, resyncs) = open(Shape::IdleInWindow, true).await;
    let (messages, _) = window.expect("the tail serves the first window");
    assert!(
        messages.iter().any(|m| m.id == "request"),
        "the renamed boundary is part of the window"
    );
    assert_eq!(resyncs, 0);
}
