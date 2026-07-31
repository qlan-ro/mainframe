//! `ctx.github` never panics and never reaches the network: without the
//! `http:outbound` capability, or without a wired dependency (the automations
//! engine failed to start), every call fails loudly with a readable reason
//! (D2, fact 10).

use std::path::PathBuf;
use std::sync::Arc;

use mainframe_types::chat::{Chat, Project};
use mainframe_types::plugin::{PluginCapability, PluginManifest};

use super::context::{EmitSink, PluginContextDeps, PluginHostDb, build_plugin_context};
use super::event_bus::PublicDaemonBus;
use super::github_port::{GitHubIssues, RepoRef};

#[derive(Default)]
struct NullHostDb;
impl PluginHostDb for NullHostDb {
    fn chats_list(&self, _p: &str) -> Vec<Chat> {
        Vec::new()
    }
    fn chats_get(&self, _id: &str) -> Option<Chat> {
        None
    }
    fn chats_create(&self, p: &str, a: &str, _m: Option<&str>, _mode: Option<&str>) -> Chat {
        serde_json::from_value(serde_json::json!({
            "id": "chat-1", "adapterId": a, "projectId": p, "status": "active",
            "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z",
            "totalCost": 0.0, "totalTokensInput": 0, "totalTokensOutput": 0,
            "lastContextTokensInput": 0,
        }))
        .unwrap()
    }
    fn settings_get(&self, _c: &str, _k: &str) -> Option<String> {
        None
    }
    fn settings_set(&self, _c: &str, _k: &str, _v: &str) {}
    fn projects_list(&self) -> Vec<Project> {
        Vec::new()
    }
    fn projects_get(&self, _id: &str) -> Option<Project> {
        None
    }
}

/// A `GitHubIssues` that never gets called — used to prove the capability
/// gate wins even when a dependency is wired.
struct UnusedGitHub;
impl GitHubIssues for UnusedGitHub {
    fn list_open_issues(
        &self,
        _repo: &RepoRef,
        _credential_label: &str,
    ) -> super::BoxFuture<
        '_,
        Result<Vec<super::github_port::IssueSnapshot>, super::github_port::GitHubPortError>,
    > {
        Box::pin(async { panic!("must not be called without the capability") })
    }
    fn get_issue(
        &self,
        _repo: &RepoRef,
        _number: u64,
        _credential_label: &str,
    ) -> super::BoxFuture<
        '_,
        Result<super::github_port::IssueSnapshot, super::github_port::GitHubPortError>,
    > {
        Box::pin(async { panic!("must not be called without the capability") })
    }
    fn issue_field_times(
        &self,
        _repo: &RepoRef,
        _number: u64,
        _credential_label: &str,
    ) -> super::BoxFuture<
        '_,
        Result<super::github_port::IssueFieldTimes, super::github_port::GitHubPortError>,
    > {
        Box::pin(async { panic!("must not be called without the capability") })
    }
    fn create_issue(
        &self,
        _repo: &RepoRef,
        _input: super::github_port::CreateIssue,
        _credential_label: &str,
    ) -> super::BoxFuture<
        '_,
        Result<super::github_port::IssueSnapshot, super::github_port::GitHubPortError>,
    > {
        Box::pin(async { panic!("must not be called without the capability") })
    }
    fn update_issue(
        &self,
        _repo: &RepoRef,
        _number: u64,
        _patch: super::github_port::IssuePatch,
        _credential_label: &str,
    ) -> super::BoxFuture<
        '_,
        Result<super::github_port::IssueSnapshot, super::github_port::GitHubPortError>,
    > {
        Box::pin(async { panic!("must not be called without the capability") })
    }
}

fn manifest(caps: Vec<PluginCapability>) -> PluginManifest {
    PluginManifest {
        id: "todos".into(),
        name: "todos".into(),
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

fn deps(caps: Vec<PluginCapability>, github: Option<Arc<dyn GitHubIssues>>) -> PluginContextDeps {
    let emit: EmitSink = Arc::new(|_| {});
    PluginContextDeps {
        manifest: manifest(caps),
        plugin_dir: PathBuf::new(),
        host_db: Arc::new(NullHostDb),
        daemon_bus: Arc::new(PublicDaemonBus::new()),
        emit,
        adapters: None,
        github,
    }
}

fn repo() -> RepoRef {
    RepoRef {
        owner: "qlan".to_string(),
        repo: "mainframe".to_string(),
    }
}

#[tokio::test]
async fn missing_capability_fails_with_the_capability_required_text() {
    let ctx = build_plugin_context(deps(vec![], Some(Arc::new(UnusedGitHub)))).unwrap();
    let err = ctx
        .github
        .get_issue(&repo(), 1, "github")
        .await
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        "Plugin capability 'http:outbound' is required but not declared in manifest"
    );
}

#[tokio::test]
async fn missing_dependency_fails_with_the_engine_unavailable_text() {
    let ctx = build_plugin_context(deps(vec![PluginCapability::HttpOutbound], None)).unwrap();
    let err = ctx
        .github
        .get_issue(&repo(), 1, "github")
        .await
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        "GitHub sync is unavailable: the automations engine did not start, so no credential store is available."
    );
}
