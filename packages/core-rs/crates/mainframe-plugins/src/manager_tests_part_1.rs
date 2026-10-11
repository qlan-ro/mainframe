use super::*;
use crate::context::NotifyOptions;
use crate::github_port::{
    CreateIssue, GitHubPortError, IssueFieldTimes, IssuePatch, IssueSnapshot, IssueState, RepoRef,
};
use mainframe_types::chat::Chat;
use mainframe_types::plugin::{PluginCapability, UiZone};
use std::sync::Mutex;

#[derive(Default)]
struct NullHostDb;
impl PluginHostDb for NullHostDb {
    fn chats_list(&self, _p: &str) -> Result<Vec<Chat>, crate::PluginError> {
        Ok(Vec::new())
    }
    fn chats_get(&self, _id: &str) -> Result<Option<Chat>, crate::PluginError> {
        Ok(None)
    }
    fn chats_create(
        &self,
        p: &str,
        a: &str,
        _m: Option<&str>,
        _mode: Option<&str>,
    ) -> Result<Chat, crate::PluginError> {
        Ok({
            serde_json::from_value(json!({
                "id": "chat-1", "adapterId": a, "projectId": p, "status": "active",
                "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z",
                "totalCost": 0.0, "totalTokensInput": 0, "totalTokensOutput": 0,
                "lastContextTokensInput": 0,
            }))
            .unwrap()
        })
    }
    fn settings(&self) -> &dyn mainframe_types::settings_kv::SettingsKv {
        static EMPTY: std::sync::LazyLock<mainframe_types::settings_kv::MemorySettings> =
            std::sync::LazyLock::new(Default::default);
        &*EMPTY
    }
}

fn manager() -> (PluginManager, Arc<Mutex<Vec<DaemonEvent>>>) {
    manager_with_github(None)
}

fn manager_with_github(
    github: Option<Arc<dyn GitHubIssues>>,
) -> (PluginManager, Arc<Mutex<Vec<DaemonEvent>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let emit: EmitSink = Arc::new(move |e| sink.lock().unwrap().push(e));
    let mgr = PluginManager::new(PluginManagerDeps {
        host_db: Arc::new(NullHostDb),
        emit,
        github,
    });
    (mgr, events)
}

/// Answers every call with a fixed snapshot — proves the manager threaded
/// this exact instance through to `ctx.github` rather than the capability
/// guard.
struct FakeGitHub;
impl GitHubIssues for FakeGitHub {
    fn list_open_issues(
        &self,
        _repo: &RepoRef,
        _credential_label: &str,
    ) -> crate::BoxFuture<'_, Result<Vec<IssueSnapshot>, GitHubPortError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn get_issue(
        &self,
        _repo: &RepoRef,
        number: u64,
        _credential_label: &str,
    ) -> crate::BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        Box::pin(async move {
            Ok(IssueSnapshot {
                number,
                title: "fake".to_string(),
                body: String::new(),
                labels: Vec::new(),
                state: IssueState::Open,
                html_url: String::new(),
                updated_at: String::new(),
            })
        })
    }
    fn issue_field_times(
        &self,
        _repo: &RepoRef,
        _number: u64,
        _credential_label: &str,
    ) -> crate::BoxFuture<'_, Result<IssueFieldTimes, GitHubPortError>> {
        Box::pin(async { Ok(IssueFieldTimes::default()) })
    }
    fn create_issue(
        &self,
        _repo: &RepoRef,
        _input: CreateIssue,
        _credential_label: &str,
    ) -> crate::BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        Box::pin(async { Err(GitHubPortError::NotFound) })
    }
    fn update_issue(
        &self,
        _repo: &RepoRef,
        _number: u64,
        _patch: IssuePatch,
        _credential_label: &str,
    ) -> crate::BoxFuture<'_, Result<IssueSnapshot, GitHubPortError>> {
        Box::pin(async { Err(GitHubPortError::NotFound) })
    }
}

fn manifest(id: &str, caps: Vec<mainframe_types::plugin::PluginCapability>) -> PluginManifest {
    PluginManifest {
        id: id.into(),
        name: id.into(),
        version: "1.0.0".into(),
        description: None,
        author: None,
        license: None,
        capabilities: caps,
        ui: None,
        adapter: None,
        commands: None,
    }
}

async fn read(resp: Response) -> (StatusCode, Value) {
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn load_builtin_registers_and_activates() {
    let (mgr, _e) = manager();
    let activated = Arc::new(Mutex::new(false));
    let flag = Arc::clone(&activated);
    mgr.load_builtin(
        manifest("test-builtin", vec![]),
        PathBuf::new(),
        move |_ctx| {
            let flag = Arc::clone(&flag);
            async move {
                *flag.lock().unwrap() = true;
                Ok(Router::new())
            }
        },
    )
    .await
    .unwrap();
    assert!(*activated.lock().unwrap());
    assert!(mgr.get_plugin("test-builtin"));
}

#[tokio::test]
async fn duplicate_id_is_skipped() {
    let (mgr, _e) = manager();
    mgr.load_builtin(manifest("dup", vec![]), PathBuf::new(), |_c| async {
        Ok(Router::new())
    })
    .await
    .unwrap();
    let second = Arc::new(Mutex::new(false));
    let flag = Arc::clone(&second);
    mgr.load_builtin(manifest("dup", vec![]), PathBuf::new(), move |_c| {
        let flag = Arc::clone(&flag);
        async move {
            *flag.lock().unwrap() = true;
            Ok(Router::new())
        }
    })
    .await
    .unwrap();
    assert!(
        !*second.lock().unwrap(),
        "activate must not run for a duplicate id"
    );
    assert_eq!(mgr.get_all().len(), 1);
}

#[tokio::test]
async fn unload_all_runs_callbacks_and_clears() {
    let (mgr, _e) = manager();
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let l = Arc::clone(&log);
    mgr.load_builtin(manifest("cleanup", vec![]), PathBuf::new(), move |ctx| {
        let l = Arc::clone(&l);
        async move {
            let a = Arc::clone(&l);
            ctx.on_unload(move || a.lock().unwrap().push("step1".into()));
            let b = Arc::clone(&l);
            ctx.on_unload(move || b.lock().unwrap().push("step2".into()));
            Ok(Router::new())
        }
    })
    .await
    .unwrap();
    assert!(mgr.get_plugin("cleanup"));
    mgr.unload_all();
    assert_eq!(mgr.get_all().len(), 0);
    assert_eq!(log.lock().unwrap().as_slice(), ["step1", "step2"]);
}

#[tokio::test]
async fn add_panel_records_and_emits_event() {
    let (mgr, events) = manager();
    mgr.load_builtin(
        manifest(
            "ui-plugin",
            vec![mainframe_types::plugin::PluginCapability::UiPanels],
        ),
        PathBuf::new(),
        |ctx| async move {
            ctx.ui.add_panel(UiZone::Fullview, "My Panel", None);
            Ok(Router::new())
        },
    )
    .await
    .unwrap();

    assert!(events.lock().unwrap().iter().any(|e| matches!(
        e,
        DaemonEvent::PluginPanelRegistered { plugin_id, label, .. }
            if plugin_id == "ui-plugin" && label == "My Panel"
    )));

    // Listing reflects the tracked panel.
    let (status, body) = read(list_plugins(State(Arc::clone(&mgr.inner))).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["plugins"][0]["panels"][0]["label"], json!("My Panel"));
}

#[tokio::test]
async fn panels_preserve_insertion_order() {
    // Two panels registered fullview-then-sidebar must list in that order
    // (and `.panel` = panels[0] must be the fullview one) on every run — the
    // Vec-backed tracker is deterministic where the old HashMap was not.
    let (mgr, _e) = manager();
    mgr.load_builtin(
        manifest(
            "ordered",
            vec![mainframe_types::plugin::PluginCapability::UiPanels],
        ),
        PathBuf::new(),
        |ctx| async move {
            ctx.ui.add_panel(UiZone::Fullview, "First", None);
            ctx.ui.add_panel(UiZone::RightTop, "Second", None);
            Ok(Router::new())
        },
    )
    .await
    .unwrap();
    let (_, body) = read(list_plugins(State(Arc::clone(&mgr.inner))).await).await;
    assert_eq!(body["plugins"][0]["panels"][0]["label"], json!("First"));
    assert_eq!(body["plugins"][0]["panels"][1]["label"], json!("Second"));
    assert_eq!(body["plugins"][0]["panel"]["label"], json!("First"));
}
