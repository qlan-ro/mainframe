//! Red-phase (Task 11): `GET /api/chats/{id}/messages` folding `ctx.claude_workflows`'s
//! retained runs with on-disk `wf_<runId>.json` records into
//! `ChatHistoryPayload.workflowRuns`. Turned green by Tasks 21-25.
//!
//! `support::spawn_test_server_with` hardcodes `chat_manager: None` (the route
//! 500s without one) and has no `claude_workflows` field yet, so this file
//! builds its own harness: a real `ChatManager` via `build_chat_manager`
//! (`chat_background_activity.rs`'s pattern) wired into a real `axum::serve`
//! instance (`support::spawn_test_server_with`'s pattern), plus the
//! not-yet-existing `claude_workflows` store field Task 22 adds to `AppCtx`.
//!
//! `record()`'s nested `json!` fixture (phases + workflow_progress agents) needs
//! more than the default macro depth to expand.
#![recursion_limit = "256"]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use mainframe_adapter_api::AdapterRegistry;
use mainframe_adapter_claude::transcript::get_session_jsonl_path;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::{ClaudeWorkflowStore, ProgressUsage};
use mainframe_db::DatabaseManager;
use mainframe_db::chats::ChatUpdate;
use mainframe_server::ctx::{AppCtx, Services};
use mainframe_server::{
    Db, GitFactory, build_app, build_chat_manager, chat_seams::NoopLaunchStopper,
    chat_seams::NoopScopeTunnelStopper, spawn_broadcast_pump,
};
use mainframe_services::attachment::AttachmentStore;
use mainframe_services::files::FileWatcherService;
use mainframe_services::push::PushService;
use mainframe_services::quota::{QuotaManager, QuotaManagerDeps, QuotaSettingsStore};
use mainframe_types::events::DaemonEvent;
use serde_json::{Value, json};
use tempfile::TempDir;
use tokio::net::TcpListener;

struct NoopQuotaSettings;
impl QuotaSettingsStore for NoopQuotaSettings {
    fn get(&self, _category: &str, _key: &str) -> Option<String> {
        None
    }
    fn get_by_category(&self, _category: &str) -> HashMap<String, String> {
        HashMap::new()
    }
    fn set(&self, _category: &str, _key: &str, _value: &str) {}
}

/// `get_session_jsonl_path` always derives under the real `~/.claude/projects`
/// tree (`transcript.rs`'s own seam), so scenarios with an on-disk record write
/// there and clean up on drop, even on panic.
struct RemoveDirOnDrop(String);
impl Drop for RemoveDirOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Harness {
    addr: SocketAddr,
    store: Arc<ClaudeWorkflowStore>,
    chat_id: String,
    project_path: String,
    _data_dir: TempDir,
}

async fn harness(session_id: &str) -> Harness {
    let data_dir = tempfile::tempdir().unwrap();
    let db = Db::spawn(|| DatabaseManager::open(Path::new(":memory:"))).unwrap();
    let (broadcast, _keepalive) = tokio::sync::broadcast::channel::<DaemonEvent>(64);
    let watcher_tx = broadcast.clone();
    let watcher = FileWatcherService::new(move |event| {
        let _ = watcher_tx.send(event);
    });
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let store = Arc::new(ClaudeWorkflowStore::new());
    let attachments = Arc::new(AttachmentStore::new(data_dir.path().join("attachments")));
    let push = Arc::new(PushService::new());
    let quota = Arc::new(QuotaManager::new(QuotaManagerDeps {
        settings: Box::new(NoopQuotaSettings),
        emit_event: Box::new(|_| {}),
        now: None,
    }));

    let project_path = data_dir.path().to_string_lossy().into_owned();
    let project = db
        .call_blocking({
            let project_path = project_path.clone();
            move |d| d.projects.create(&project_path, None)
        })
        .unwrap();
    let chat = db
        .call_blocking({
            let project_id = project.id.clone();
            move |d| d.chats.create(&project_id, "claude", None, None, None)
        })
        .unwrap();
    db.call_blocking({
        let chat_id = chat.id.clone();
        let session_id = session_id.to_string();
        move |d| {
            d.chats.update(
                &chat_id,
                &ChatUpdate {
                    claude_session_id: Some(session_id),
                    ..Default::default()
                },
            )
        }
    })
    .unwrap();

    let manager = build_chat_manager(
        db.clone(),
        Arc::new(AdapterRegistry::new()),
        Arc::clone(&tracker),
        Arc::clone(&attachments),
        Arc::clone(&push),
        GitFactory,
        broadcast.clone(),
        Arc::new(NoopLaunchStopper),
        Arc::new(NoopScopeTunnelStopper),
        quota,
        Arc::clone(&store),
        mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
    );

    let ctx = Arc::new(AppCtx {
        db,
        git: GitFactory,
        services: Services {
            attachments,
            push,
            watcher: Arc::new(watcher),
        },
        broadcast,
        adapter_registry: Arc::new(AdapterRegistry::new()),
        background_tasks: tracker,
        claude_workflows: Arc::clone(&store),
        chat_manager: Some(manager),
        launch_registry: None,
        tunnel_manager: None,
        port_tunnels: None,
        lsp_manager: None,
        plugin_manager: None,
        automations: None,
        quota: None,
        data_dir: data_dir.path().to_path_buf(),
        version: "0.0.0-test".to_string(),
        port: 0,
        auth_secret: None,
        resolved_path: mainframe_runtime::ResolvedPath::from_value("/usr/bin:/bin"),
        tunnel_url: Arc::new(std::sync::RwLock::new(None)),
        ws_clients: Arc::new(DashMap::new()),
        facade_clients: Arc::new(DashMap::new()),
        facade_heartbeat_interval_ms: mainframe_acp::DEFAULT_HEARTBEAT_INTERVAL_MS,
    });
    spawn_broadcast_pump(Arc::clone(&ctx));

    let app = build_app(Arc::clone(&ctx));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let served = ctx.clone();
    tokio::spawn(async move {
        let _ = served;
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
    });
    tokio::time::sleep(Duration::from_millis(20)).await;

    Harness {
        addr,
        store,
        chat_id: chat.id,
        project_path,
        _data_dir: data_dir,
    }
}

impl Harness {
    fn http_url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }

    async fn messages(&self) -> Value {
        reqwest::get(self.http_url(&format!("/api/chats/{}/messages", self.chat_id)))
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
    }
}

/// Writes `wf_<runId>.json` into the real `~/.claude/projects/<encoded>/<sessionId>/workflows/`
/// tree the future route resolves from the chat's `claude_session_id` + project path, returning
/// a guard that removes the whole encoded project dir on drop.
fn write_record(
    project_path: &str,
    session_id: &str,
    run_id: &str,
    task_id: &str,
) -> RemoveDirOnDrop {
    let derived = get_session_jsonl_path(session_id, project_path);
    let workflows_dir = Path::new(&derived.project_dir)
        .join(session_id)
        .join("workflows");
    std::fs::create_dir_all(&workflows_dir).unwrap();
    std::fs::write(
        workflows_dir.join(format!("wf_{run_id}.json")),
        serde_json::to_string(&record(run_id, task_id)).unwrap(),
    )
    .unwrap();
    RemoveDirOnDrop(derived.project_dir)
}

/// A live `task_progress` snapshot payload — the in-memory counterpart of a
/// record's `workflowProgress`.
fn snapshot_entries() -> Vec<Value> {
    vec![
        json!({ "type": "workflow_phase", "index": 0, "title": "Plan" }),
        json!({
            "type": "workflow_agent",
            "index": 0,
            "label": "core-dev",
            "phaseIndex": 0,
            "agentId": "agent-alpha",
            "state": "progress",
            "tokens": 42,
            "toolCalls": 1,
            "durationMs": 2_000
        }),
    ]
}

fn record(run_id: &str, task_id: &str) -> Value {
    json!({
        "runId": run_id,
        "timestamp": "2026-07-30T12:00:00.000Z",
        "taskId": task_id,
        "script": "workflows/todo-lane.md",
        "scriptPath": "/proj/.claude/workflows/todo-lane.md",
        "result": "ok",
        "agentCount": 1,
        "logs": ["[plan] done"],
        "durationMs": 45000,
        "summary": "Ran the todo lane to completion.",
        "workflowName": "todo-lane",
        "status": "completed",
        "startTime": "2026-07-30T11:59:15.000Z",
        "phases": [{ "index": 0, "title": "Plan" }],
        "defaultModel": "claude-sonnet-5",
        "workflowProgress": [
            { "type": "workflow_phase", "index": 0, "title": "Plan", "kind": "planning" },
            {
                "type": "workflow_agent",
                "index": 0,
                "label": "core-dev",
                "phaseIndex": 0,
                "phaseTitle": "Plan",
                "agentId": "agent-alpha",
                "agentType": "core-dev",
                "isolation": "worktree",
                "model": "claude-sonnet-5",
                "fallbackModel": null,
                "state": "done",
                "startedAt": 1_700_000_000_000i64,
                "queuedAt": 1_699_999_999_000i64,
                "attempt": 1,
                "lastAttemptReason": null,
                "lastToolName": "Read",
                "lastToolSummary": "Read plan.md",
                "promptPreview": "Draft the implementation plan",
                "lastProgressAt": 1_700_000_005_000i64,
                "tokens": 1200,
                "toolCalls": 3,
                "durationMs": 5000,
                "cached": false,
                "blocked": false,
                "error": null,
                "resultPreview": "Plan drafted",
                "remoteSessionId": null
            }
        ],
        "totalTokens": 5500,
        "totalToolCalls": 3
    })
}

#[tokio::test]
async fn a_chat_that_never_ran_a_workflow_reports_no_runs() {
    let h = harness("sess-never").await;
    let body = h.messages().await;
    assert_eq!(body["success"], true);
    assert_eq!(body["data"]["workflowRuns"], json!([]));
}

#[tokio::test]
async fn a_terminal_record_with_no_retained_snapshot_surfaces_as_a_record_sourced_run() {
    let h = harness("sess-record-only").await;
    let _cleanup = write_record(&h.project_path, "sess-record-only", "run-42", "task-9");

    let body = h.messages().await;
    let runs = body["data"]["workflowRuns"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["source"], "record");
    assert_eq!(runs[0]["taskId"], "task-9");
    assert_eq!(runs[0]["runId"], "run-42");
    assert_eq!(runs[0]["phases"].as_array().unwrap().len(), 1);
    assert_eq!(runs[0]["agents"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn a_terminal_record_supersedes_a_retained_snapshot_for_the_same_task() {
    let h = harness("sess-both").await;
    h.store.seed(&h.chat_id, "task-9", None);
    h.store.apply_progress(
        &h.chat_id,
        "task-9",
        ProgressUsage {
            total_tokens: 10,
            duration_ms: 1_000,
        },
        None,
    );
    let _cleanup = write_record(&h.project_path, "sess-both", "run-42", "task-9");

    let body = h.messages().await;
    let runs = body["data"]["workflowRuns"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["source"], "record");
    assert_eq!(runs[0]["runId"], "run-42");
    assert_eq!(runs[0]["taskId"], "task-9");
}

#[tokio::test]
async fn a_retained_snapshot_with_no_record_surfaces_unchanged() {
    let h = harness("sess-snapshot-only").await;
    h.store
        .seed(&h.chat_id, "task-3", Some("deploy".to_string()));
    // `Some(&[])` establishes the retained snapshot the test's name and
    // `source: "snapshot"` assertion depend on; `None` (the fixture's original
    // arg) only updates totals per the store contract and leaves the run
    // `Launch`-sourced (mainframe-claude-workflows/src/store.rs `apply_progress`).
    h.store.apply_progress(
        &h.chat_id,
        "task-3",
        ProgressUsage {
            total_tokens: 42,
            duration_ms: 2_000,
        },
        Some(&[]),
    );

    let body = h.messages().await;
    let runs = body["data"]["workflowRuns"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["source"], "snapshot");
    assert_eq!(runs[0]["taskId"], "task-3");
    assert_eq!(runs[0]["workflowName"], "deploy");
    assert_eq!(runs[0]["totalTokens"], 42);
    assert_eq!(runs[0]["structureRevision"], 2_000);
    assert_eq!(runs[0]["phases"], json!([]));
    assert_eq!(runs[0]["agents"], json!([]));
}

#[tokio::test]
async fn a_retained_snapshots_phases_and_agents_survive_the_route() {
    let h = harness("sess-snapshot-structure").await;
    h.store.seed(&h.chat_id, "task-4", None);
    h.store.apply_progress(
        &h.chat_id,
        "task-4",
        ProgressUsage {
            total_tokens: 42,
            duration_ms: 2_000,
        },
        Some(&snapshot_entries()),
    );

    let body = h.messages().await;
    let runs = body["data"]["workflowRuns"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["source"], "snapshot");
    assert_eq!(runs[0]["phases"].as_array().unwrap().len(), 1);
    assert_eq!(runs[0]["phases"][0]["title"], "Plan");
    assert_eq!(runs[0]["agents"].as_array().unwrap().len(), 1);
    assert_eq!(runs[0]["agents"][0]["agentId"], "agent-alpha");
    assert_eq!(runs[0]["agents"][0]["state"], "progress");
}
