use mainframe_adapter_api::AdapterError;
use mainframe_types::sync::LockExt as _;
use serde_json::json;

use super::CodexSession;
use crate::turn_model::non_empty;

pub(super) fn explicit_model(model: Option<&str>) -> Option<String> {
    non_empty(model)
        .filter(|model| *model != "default")
        .map(str::to_owned)
}

impl CodexSession {
    pub(super) async fn configured_cli_model(&self) -> Result<String, AdapterError> {
        let executable = self.history_executable.lock_recover().clone();
        crate::effective_model::probe(&executable, self.resolved_path.as_str(), &self.project_path)
            .await
            .ok_or_else(|| {
                AdapterError::Message("Could not resolve the configured Codex model".into())
            })
    }

    pub(super) async fn model_for_turn(
        &self,
        model: Option<String>,
    ) -> Result<Option<String>, AdapterError> {
        let needs_resume = (self.resume_thread_id.is_some() || self.fork_source.is_some())
            && self.state.lock_recover().thread_id.is_none();
        if model.is_none() && needs_resume {
            let model = self.configured_cli_model().await?;
            self.config.lock_recover().model = Some(model.clone());
            return Ok(Some(model));
        }
        Ok(model)
    }

    pub(super) async fn read_effective_model(&self) -> Option<String> {
        let client = self.client.lock_recover().clone()?;
        let thread = self.state.lock_recover().thread_id.clone()?;
        match client
            .request(
                "thread/read",
                Some(json!({"threadId": thread, "includeTurns": false})),
            )
            .await
        {
            Ok(result) => non_empty(result["thread"]["model"].as_str()).map(str::to_owned),
            Err(error) => {
                tracing::warn!(module = "codex:models", %error, "could not read the current Codex model");
                None
            }
        }
    }
}
