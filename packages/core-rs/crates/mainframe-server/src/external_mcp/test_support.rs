use crate::{
    chat_test_support::{LiveStub, StubAdapter},
    ctx::AppCtx,
};
use mainframe_types::{adapter::ControlRequest, chat::NewChat, settings::ExecutionMode};
use serde_json::{Value, json};
use std::{collections::HashMap, net::SocketAddr, sync::Arc};

pub struct Server {
    pub base: String,
    pub ctx: Arc<AppCtx>,
    pub project: String,
    pub other_project: String,
    pub chat: String,
    pub other_chat: String,
    live: Option<Arc<LiveStub>>,
    task: tokio::task::JoinHandle<()>,
    _dir: tempfile::TempDir,
}

impl Server {
    pub async fn start() -> Self {
        Self::with_adapter(StubAdapter::new("claude", false)).await
    }

    /// A server whose chats really start: sends are accepted, and `live()`
    /// raises session events and records the answers the session received.
    pub async fn start_live() -> Self {
        Self::with_adapter(StubAdapter::live("claude")).await
    }

    pub fn live(&self) -> &LiveStub {
        self.live.as_deref().unwrap()
    }

    async fn with_adapter(adapter: Arc<StubAdapter>) -> Self {
        let live = adapter.live.clone();
        let ctx = AppCtx::test_ctx();
        ctx.core.adapter_registry.register(adapter);
        ctx.core
            .adapter_registry
            .configure_refresh(Arc::new(Refresh));
        ctx.core.adapter_registry.seed_static_snapshots();
        ctx.core.adapter_registry.allow_refresh();
        ctx.core.adapter_registry.refresh_all().await;
        let dir = tempfile::tempdir().unwrap();
        let (project, other_project) = projects(&ctx, dir.path()).await;
        let chat = create_chat(&ctx, &project).await;
        let other_chat = create_chat(&ctx, &other_project).await;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = crate::http::build_app(ctx.clone());
        let task = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        });
        Self {
            base,
            ctx,
            project,
            other_project,
            chat,
            other_chat,
            live,
            task,
            _dir: dir,
        }
    }

    pub async fn grant(&self, access: &str, ceiling: &str) -> Value {
        let response = self.create_client(access, ceiling, false).await;
        assert_eq!(response.status(), 200);
        response.json::<Value>().await.unwrap()["data"].clone()
    }

    /// The key of a control client that may also answer prompts.
    pub async fn answering_key(&self, ceiling: &str) -> String {
        let response = self.create_client("control", ceiling, true).await;
        assert_eq!(response.status(), 200);
        let grant = response.json::<Value>().await.unwrap();
        grant["data"]["token"].as_str().unwrap().to_owned()
    }

    pub async fn create_client(
        &self,
        access: &str,
        ceiling: &str,
        answers: bool,
    ) -> reqwest::Response {
        reqwest::Client::new()
            .post(format!("{}/api/external-mcp/clients", self.base))
            .json(
                &json!({"name":"Voice test","projectIds":[self.project],"access":access,
                "maxPermissionMode":ceiling,"answerPrompts":answers}),
            )
            .send()
            .await
            .unwrap()
    }

    pub async fn rpc(&self, token: &str, method: &str, params: Value) -> Value {
        self.post(token)
            .json(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
    }

    pub async fn call(&self, token: &str, name: &str, args: Value) -> Value {
        self.rpc(token, "tools/call", json!({"name":name,"arguments":args}))
            .await
    }

    pub fn post(&self, token: &str) -> reqwest::RequestBuilder {
        reqwest::Client::new()
            .post(format!("{}/mcp/external", self.base))
            .bearer_auth(token)
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn projects(ctx: &AppCtx, root: &std::path::Path) -> (String, String) {
    let a = root.join("allowed");
    let b = root.join("private");
    std::fs::create_dir_all(&a).unwrap();
    std::fs::create_dir_all(&b).unwrap();
    ctx.core
        .db
        .call(move |db| {
            Ok((
                db.projects
                    .create(&a.to_string_lossy(), Some("Allowed"))?
                    .id,
                db.projects
                    .create(&b.to_string_lossy(), Some("Private"))?
                    .id,
            ))
        })
        .await
        .unwrap()
}

async fn create_chat(ctx: &AppCtx, project: &str) -> String {
    ctx.chat
        .chat_manager
        .create_chat(NewChat {
            project_id: project.into(),
            adapter_id: "claude".into(),
            permission_mode: Some(ExecutionMode::Default.as_str().into()),
            ..Default::default()
        })
        .await
        .unwrap()
        .id
}

struct Refresh;
impl mainframe_adapter_api::RefreshDeps for Refresh {
    fn resolve_executable_path(
        &self,
        _: String,
    ) -> mainframe_adapter_api::BoxFuture<'_, Option<String>> {
        Box::pin(async { None })
    }
    fn run(
        &self,
        _: String,
        _: Vec<String>,
        _: Option<u64>,
    ) -> mainframe_adapter_api::BoxFuture<'_, mainframe_adapter_api::RunResult> {
        Box::pin(async {
            mainframe_adapter_api::RunResult {
                ok: true,
                stdout: "1.0.0".into(),
            }
        })
    }
    fn emit_event(&self, _: mainframe_types::events::DaemonEvent) {}
}

pub fn request(id: &str, tool: &str, input: Value) -> ControlRequest {
    ControlRequest {
        request_id: id.into(),
        tool_name: tool.into(),
        tool_use_id: format!("toolu_{id}"),
        input: serde_json::from_value::<HashMap<String, Value>>(input).unwrap(),
        suggestions: Vec::new(),
        decision_reason: None,
        options: None,
    }
}

/// Yields until `done`, for state another task on this runtime is about to
/// reach; fails the test when it never does.
pub async fn until(mut done: impl FnMut() -> bool) {
    let reached = async {
        while !done() {
            tokio::task::yield_now().await;
        }
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), reached)
        .await
        .unwrap();
}
