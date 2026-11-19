use crate::{chat_test_support::StubAdapter, ctx::AppCtx};
use mainframe_types::{chat::NewChat, settings::ExecutionMode};
use serde_json::{Value, json};
use std::{net::SocketAddr, sync::Arc};

pub struct Server {
    pub base: String,
    pub ctx: Arc<AppCtx>,
    pub project: String,
    pub other_project: String,
    pub chat: String,
    pub other_chat: String,
    task: tokio::task::JoinHandle<()>,
    _dir: tempfile::TempDir,
}

impl Server {
    pub async fn start() -> Self {
        let ctx = AppCtx::test_ctx();
        ctx.core
            .adapter_registry
            .register(StubAdapter::new("claude", false));
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
            task,
            _dir: dir,
        }
    }

    pub async fn grant(&self, access: &str, ceiling: &str) -> Value {
        let response = reqwest::Client::new().post(format!("{}/api/external-mcp/clients", self.base))
            .json(&json!({"name":"Voice test","projectIds":[self.project],"access":access,"maxPermissionMode":ceiling}))
            .send().await.unwrap();
        assert_eq!(response.status(), 200);
        response.json::<Value>().await.unwrap()["data"].clone()
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
