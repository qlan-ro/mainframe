//! `chat_launch` / `delegate_task` chat creation over `ChatManager`: validate
//! the workspace first, create the chat, provision its worktree, then apply
//! plan mode, title, and agent provenance.

use mainframe_orchestration::errors::{ErrorCode, PortError, ToolError};
use mainframe_orchestration::ports::{ChatView, LaunchRequest, LaunchWorkspace};
use mainframe_types::chat::{NO_PROJECT_ID, NewChat};

use super::chat_port::DaemonOrchestrationPort;
use super::workspace::{check_existing_worktree, check_new_worktree, invalid};

/// Where the new chat's row points before any worktree is provisioned.
struct Placement {
    worktree_path: Option<String>,
    branch_name: Option<String>,
    /// `(base, branch)` to provision after the row exists.
    new_worktree: Option<(String, String)>,
}

impl DaemonOrchestrationPort {
    pub(super) async fn launch(&self, request: LaunchRequest) -> Result<ChatView, PortError> {
        let placement = self.place(&request).await?;
        let mode = serde_json::to_value(request.permission_mode)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string));
        let chat = self
            .chats
            .create_chat_with_defaults(
                NewChat {
                    project_id: request.project_id.clone(),
                    adapter_id: request.adapter_id.clone(),
                    model: request.model.clone(),
                    permission_mode: mode,
                    automation_run_id: None,
                    temporary: false,
                    scratch_root: None,
                },
                placement.worktree_path.as_deref(),
                placement.branch_name.as_deref(),
            )
            .await;
        if let Some((base, branch)) = &placement.new_worktree
            && let Err(err) = self.chats.enable_worktree(&chat.id, base, branch).await
        {
            // The chat would otherwise run in the project root, which the
            // caller did not ask for; retire it instead of leaving a stray.
            tracing::warn!(chat_id = chat.id, %err, "worktree provisioning failed; archiving the new chat");
            self.chats.archive_chat(&chat.id, false).await;
            return Err(invalid(format!("Could not create the worktree: {err}")));
        }
        self.finish(&chat.id, &request).await
    }

    /// Resolves and validates where the chat runs, before anything exists.
    async fn place(&self, request: &LaunchRequest) -> Result<Placement, PortError> {
        let shared = |worktree_path: Option<String>, branch_name: Option<String>| Placement {
            worktree_path,
            branch_name,
            new_worktree: None,
        };
        if request.project_id == NO_PROJECT_ID {
            return match &request.workspace {
                LaunchWorkspace::ProjectRoot => Ok(shared(None, None)),
                _ => Err(invalid("A non-project chat has no worktree to use")),
            };
        }
        let project_path = self.project_path(&request.project_id).await?;
        match &request.workspace {
            LaunchWorkspace::ProjectRoot => Ok(shared(None, None)),
            LaunchWorkspace::Shared {
                worktree_path,
                branch_name,
            } => Ok(shared(worktree_path.clone(), branch_name.clone())),
            LaunchWorkspace::NewWorktree {
                base_branch,
                branch_name,
            } => {
                check_new_worktree(&project_path, base_branch, branch_name).await?;
                Ok(Placement {
                    new_worktree: Some((base_branch.clone(), branch_name.clone())),
                    ..shared(None, None)
                })
            }
            LaunchWorkspace::ExistingWorktree { worktree_path } => {
                let (path, branch) = check_existing_worktree(&project_path, worktree_path).await?;
                Ok(shared(Some(path), branch))
            }
        }
    }

    async fn project_path(&self, project_id: &str) -> Result<String, PortError> {
        let id = project_id.to_string();
        let project = self
            .db
            .call(move |d| d.projects.get(&id))
            .await
            .map_err(|err| PortError::Internal(format!("read project: {err}")))?;
        project.map(|p| p.path).ok_or_else(|| {
            PortError::Public(ToolError::new(
                ErrorCode::ProjectNotFound,
                format!("No project {project_id}."),
            ))
        })
    }

    /// Plan mode, title, and provenance, then the chat as it now stands.
    async fn finish(&self, chat_id: &str, request: &LaunchRequest) -> Result<ChatView, PortError> {
        if request.plan_mode {
            self.chats
                .update_chat_config(chat_id, None, None, None, Some(true))
                .await
                .map_err(|err| PortError::Internal(format!("set plan mode: {err}")))?;
        }
        if let Some(title) = &request.title {
            self.chats.rename_chat(chat_id, title);
        }
        let (id, creator) = (chat_id.to_string(), request.created_by_chat_id.clone());
        let parent = request.parent_chat_id.clone();
        self.db
            .call(move |d| d.chats.set_agent_lineage(&id, &creator, parent.as_deref()))
            .await
            .map_err(|err| PortError::Internal(format!("record provenance: {err}")))?;
        // The live cell was built before the lineage write; pull it in so the
        // sidebar nests a child (and names its creator) without a reload.
        self.chats.refresh_agent_lineage(chat_id);
        let chat = self
            .chats
            .get_chat(chat_id)
            .ok_or_else(|| PortError::Internal(format!("launched chat {chat_id} vanished")))?;
        Ok(self.view(chat).await)
    }
}
