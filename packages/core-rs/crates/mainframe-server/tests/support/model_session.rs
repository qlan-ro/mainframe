use std::{os::unix::fs::PermissionsExt, sync::Arc, time::Duration};

use mainframe_adapter_claude::adapter::ClaudeAdapter;
use mainframe_chat::chat_manager::ChatManager;
use mainframe_types::chat_patch::ChatPatch;
use serde_json::Value;

use crate::support::facade::{FacadeServer, spawn_facade_server};

pub const SESSION_ID: &str = "f3f7c244-ff7b-4c78-8ed6-eac256ed082a";

pub struct ModelSession(pub FacadeServer);

impl ModelSession {
    pub async fn new() -> Self {
        Self::with_models(Some("default"), None).await
    }

    pub async fn with_models(chat_model: Option<&str>, provider_model: Option<&str>) -> Self {
        let harness = spawn_facade_server(Arc::new(ClaudeAdapter::default())).await;
        let root = &harness.server.ctx.data_dir;
        let exe = root.join("claude-model-cli");
        std::fs::write(&exe, include_str!("claude_model_cli.py")).unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(root.join("configured-model"), "claude-fable-5-1").unwrap();
        std::fs::write(root.join("transcript-model"), "claude-opus-5-5").unwrap();
        let transcript = root.join("transcript.jsonl");
        std::fs::write(&transcript, "").unwrap();
        let executable = exe.to_string_lossy().into_owned();
        let chat_id = harness.chat_id.clone();
        let chat_model = chat_model.map(str::to_owned);
        let provider_model = provider_model.map(str::to_owned);
        harness
            .server
            .ctx
            .db
            .call(move |db| {
                db.settings
                    .set("provider", "claude.executablePath", &executable)?;
                if let Some(model) = provider_model {
                    db.settings.set("provider", "claude.defaultModel", &model)?;
                }
                db.chats.update(
                    &chat_id,
                    &ChatPatch {
                        model: chat_model,
                        claude_session_id: Some(SESSION_ID.into()),
                        session_file_path: Some(transcript.to_string_lossy().into_owned()),
                        ..Default::default()
                    },
                )
            })
            .await
            .unwrap();
        let fixture = Self(harness);
        fixture.resume().await;
        fixture
    }

    pub fn manager(&self) -> &Arc<ChatManager> {
        self.0.server.ctx.chat_manager.as_ref().unwrap()
    }

    pub async fn resume(&self) {
        let manager = self.manager();
        manager.resume_chat(&self.0.chat_id).await;
        tokio::time::timeout(Duration::from_secs(10), manager.start_chat(&self.0.chat_id))
            .await
            .unwrap();
        assert!(manager.is_chat_running(&self.0.chat_id));
        assert!(self.running_model().await.is_string());
    }

    pub async fn stop(&self) {
        self.manager()
            .get_session_for_chat(&self.0.chat_id)
            .unwrap()
            .kill()
            .await
            .unwrap();
        assert!(!self.manager().is_chat_running(&self.0.chat_id));
    }

    pub async fn select(
        &self,
        model: &str,
    ) -> Result<(), mainframe_chat::config_manager::ConfigError> {
        tokio::time::timeout(
            Duration::from_secs(10),
            self.manager().update_chat_config(
                &self.0.chat_id,
                None,
                Some(model.into()),
                None,
                None,
            ),
        )
        .await
        .unwrap()
    }

    pub async fn saved_model(&self) -> String {
        let id = self.0.chat_id.clone();
        self.0
            .server
            .ctx
            .db
            .call(move |db| db.chats.get(&id))
            .await
            .unwrap()
            .unwrap()
            .model
            .unwrap()
    }

    pub async fn running_model(&self) -> Value {
        reqwest::Client::new()
            .get(self.0.server.http_url(&format!(
                "/api/adapters/claude/effective-model?chatId={}",
                self.0.chat_id
            )))
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["data"]
            .clone()
    }

    pub fn configure(&self, model: &str) {
        std::fs::write(self.0.server.ctx.data_dir.join("configured-model"), model).unwrap();
    }

    pub async fn provider_model(&self, model: &str) {
        let model = model.to_owned();
        self.0
            .server
            .ctx
            .db
            .call(move |db| db.settings.set("provider", "claude.defaultModel", &model))
            .await
            .unwrap();
    }

    pub fn session_launches(&self) -> Vec<Vec<String>> {
        std::fs::read_to_string(self.0.server.ctx.data_dir.join("launches.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Vec<String>>(line).unwrap())
            .filter(|args| !args.iter().any(|arg| arg == "--no-session-persistence"))
            .collect()
    }
}

impl Drop for ModelSession {
    fn drop(&mut self) {
        self.0
            .server
            .ctx
            .adapter_registry
            .get("claude")
            .unwrap()
            .kill_all();
        self.manager().dispose();
    }
}
