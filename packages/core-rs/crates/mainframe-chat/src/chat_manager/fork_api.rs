//! `ChatManager::fork_chat` — the daemon-side orchestration of the Fork action
//! (whole chat or from a message): the ordered eligibility checks, resolving a
//! from-message cut, pinning the fork point through the parent's adapter, and
//! the single INSERT that creates the fork.
use mainframe_adapter_api::ForkCut;
use mainframe_types::sync::LockExt as _;

use mainframe_types::segment::ForkPlan;

use super::*;
use crate::fork::ForkPoint;
use crate::fork_cut::resolve_segment_fork_cut;
use crate::segments::fork_plan::{ForkPoint as SegmentForkPoint, fork_plan};

/// A turn is in flight when the main turn is running, or a permission/question
/// answer is pending. Deliberately NOT `display_status == Working` — live
/// background tasks alone put a chat in that state (spec edge case: "The parent
/// has background tasks still running but no turn in flight. Fork is allowed.").
fn turn_in_flight(chat: &Chat) -> bool {
    chat.is_running == Some(true) || chat.display_status == Some(DisplayStatus::Waiting)
}

/// The parent as `fork_chat`'s eligibility checks found it.
struct EligibleParent {
    chat: Chat,
    adapter_name: String,
    source_session_id: String,
}

impl ChatManager {
    /// Fork `chat_id` into a new chat that inherits its conversation up to
    /// `point`. Checks run in the spec's order (not found, capability,
    /// temporary, no project, no session, transcript missing, directory
    /// missing, then turn in flight for `Current` or the message rules for
    /// `BeforeMessage`), then pins the fork point and inserts the new row. A
    /// failure after the eligibility checks removes any snapshot directory it
    /// created and leaves no chat row.
    ///
    /// `BeforeMessage` allows a turn in flight: everything before a sent
    /// message is already settled, so the cut can't move.
    pub async fn fork_chat(&self, chat_id: &str, point: ForkPoint) -> Result<Chat, ForkChatError> {
        let parent = self.fork_eligible_parent(chat_id)?;
        let cut = match &point {
            ForkPoint::Current if turn_in_flight(&parent.chat) => {
                return Err(ForkChatError::TurnInFlight);
            }
            ForkPoint::Current => None,
            ForkPoint::BeforeMessage(message_id) => Some(self.fork_cut(chat_id, message_id).await?),
        };
        let segments = self.fork_segment_plan(chat_id, cut.as_ref());
        let (fork_source, dest_dir) = self.pin_fork(&parent, cut).await?;
        self.insert_fork(&parent.chat, fork_source, dest_dir, segments)
            .await
    }

    /// A multi-segment parent's segments as the fork copies them: those on
    /// the active segment's native session ride the pin, every other one is
    /// borrowed read-only and bounded where it ended. `None` for a
    /// single-segment parent, whose fork gets one initial segment as before.
    fn fork_segment_plan(&self, chat_id: &str, cut: Option<&ForkCut>) -> Option<ForkPlan> {
        let layout = self.deps.segment_store()?.layout(chat_id)?;
        if !layout.is_multi_segment() {
            return None;
        }
        let point = SegmentForkPoint {
            segment_id: layout.active()?.id.clone(),
            message_id: cut.map(|c| c.vendor_message_id.clone()),
        };
        fork_plan(&layout, &point, true)
    }

    /// Every check that holds for both fork points, in the spec's order.
    fn fork_eligible_parent(&self, chat_id: &str) -> Result<EligibleParent, ForkChatError> {
        let parent = self
            .get_chat(chat_id)
            .ok_or_else(|| ForkChatError::NotFound(chat_id.to_string()))?;

        let adapter = self.deps.adapter_fork_info(&parent.adapter_id);
        if !adapter.fork {
            return Err(match adapter.unavailable_reason {
                Some(reason) => ForkChatError::UnavailableWithReason(reason),
                None => ForkChatError::Unsupported(adapter.name),
            });
        }
        // A temporary chat never wrote a vendor transcript to branch from, and a
        // no-project chat has no checkout for the fork to run in.
        if parent.temporary {
            return Err(ForkChatError::Temporary);
        }
        if parent.no_project {
            return Err(ForkChatError::NoProject);
        }
        let Some(source_session_id) = parent.claude_session_id.clone() else {
            return Err(ForkChatError::NothingToForkYet);
        };
        if parent.transcript_missing == Some(true) {
            return Err(ForkChatError::TranscriptMissing);
        }
        if parent.directory_missing == Some(true) {
            return Err(ForkChatError::DirectoryMissing);
        }
        Ok(EligibleParent {
            chat: parent,
            adapter_name: adapter.name,
            source_session_id,
        })
    }

    /// Resolve the chat message id to the vendor id the adapter's transcript
    /// knows it by, comparing what the chat shows with what the adapter
    /// reloads from disk. A multi-segment chat composes both lists, and the
    /// cut must lie in its latest segment.
    async fn fork_cut(&self, chat_id: &str, message_id: &str) -> Result<ForkCut, ForkChatError> {
        let live = self.get_messages(chat_id).await;
        let disk = self.get_messages_from_disk(chat_id).await;
        let vendor_message_id = resolve_segment_fork_cut(&live, &disk, message_id)?;
        Ok(ForkCut { vendor_message_id })
    }

    /// Pin the fork point into a fresh snapshot directory. Any failure removes
    /// the directory, so a refused fork leaves nothing behind.
    async fn pin_fork(
        &self,
        parent: &EligibleParent,
        cut: Option<ForkCut>,
    ) -> Result<(ForkSource, String), ForkChatError> {
        let chat = &parent.chat;
        let project_path = self
            .deps
            .projects_get_path(&chat.project_id)
            .ok_or_else(|| ForkChatError::NotFound(chat.id.clone()))?;
        let cwd = chat.worktree_path.clone().unwrap_or(project_path);
        let dest_dir = std::path::Path::new(&self.deps.fork_snapshots_dir())
            .join(nanoid::nanoid!())
            .to_string_lossy()
            .into_owned();

        let request = ForkPinRequest {
            source_session_id: parent.source_session_id.clone(),
            cwd,
            session_file_path: chat.session_file_path.clone(),
            dest_dir: dest_dir.clone(),
            cut,
        };
        let err = match self.deps.pin_fork_point(&chat.adapter_id, request).await {
            Ok(source) => return Ok((source, dest_dir)),
            Err(ForkPinError::Unsupported) => {
                ForkChatError::Unsupported(parent.adapter_name.clone())
            }
            Err(ForkPinError::TranscriptMissing) => ForkChatError::TranscriptMissing,
            Err(ForkPinError::PointNotFound(reason)) => ForkChatError::ForkPointUnresolved(reason),
            Err(ForkPinError::Failed(message)) => ForkChatError::PinFailed(message),
        };
        remove_snapshot_dir(&dest_dir).await;
        Err(err)
    }

    /// The single INSERT that creates the fork from the parent's current
    /// settings, then registers and announces it.
    async fn insert_fork(
        &self,
        parent: &Chat,
        fork_source: ForkSource,
        dest_dir: String,
        segments: Option<ForkPlan>,
    ) -> Result<Chat, ForkChatError> {
        let provisional_title = fork_title(parent.title.as_deref());
        let insert = ForkCreateInput {
            parent_chat_id: parent.id.clone(),
            project_id: parent.project_id.clone(),
            adapter_id: parent.adapter_id.clone(),
            model: parent.model.clone(),
            permission_mode: parent.permission_mode,
            plan_mode: parent.plan_mode.unwrap_or(false),
            effort: parent.effort.flatten(),
            fast: parent.fast.flatten(),
            ultracode: parent.ultracode.flatten(),
            adaptive_thinking: parent.adaptive_thinking.flatten(),
            worktree_path: parent.worktree_path.clone(),
            branch_name: parent.branch_name.clone(),
            title: Some(provisional_title.clone()),
            pending_fork: PendingForkState {
                fork_source,
                snapshot_dir: dest_dir.clone(),
                provisional_title,
            },
            segments,
        };

        let new_chat = match self.deps.create_fork(&insert) {
            Ok(chat) => chat,
            Err(message) => {
                remove_snapshot_dir(&dest_dir).await;
                return Err(ForkChatError::InsertFailed(message));
            }
        };

        self.active_chats.insert(
            new_chat.id.clone(),
            Arc::new(Mutex::new(ActiveChat::new(new_chat.clone(), None))),
        );
        self.messages.lock_recover().pin(&new_chat.id);
        self.emit(DaemonEvent::ChatCreated {
            chat: new_chat.clone(),
            source: None,
        });
        Ok(new_chat)
    }
}

/// Best-effort cleanup of a snapshot directory a failed pin/insert leaves
/// behind — logged, never surfaced, matching the plan's "a failed pin removes
/// the directory" / "on insert failure it removes the directory".
async fn remove_snapshot_dir(dir: &str) {
    if let Err(err) = tokio::fs::remove_dir_all(dir).await
        && err.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!(%err, dir, "failed to remove fork snapshot directory after a failed fork");
    }
}

#[cfg(test)]
mod turn_in_flight_tests {
    use super::*;
    use crate::test_support::test_chat;

    /// `turn_in_flight` is exercised directly (rather than only through
    /// `fork_chat`'s `StoreDeps`-backed tests) because `enrich_chat` — which
    /// `get_chat` always runs — recomputes both `is_running` and
    /// `display_status` from live state (process state / the permission
    /// manager's pending queue), so a fake chat's manually-set fields never
    /// survive to `fork_chat`'s eligibility check. This is the one path that
    /// actually observes a chat "waiting" on a permission/question answer.
    #[test]
    fn a_pending_permission_is_a_turn_in_flight() {
        let mut chat = test_chat("c1");
        chat.display_status = Some(DisplayStatus::Waiting);
        assert!(turn_in_flight(&chat));
    }

    #[test]
    fn a_running_main_turn_is_a_turn_in_flight() {
        let mut chat = test_chat("c1");
        chat.is_running = Some(true);
        assert!(turn_in_flight(&chat));
    }

    /// Spec edge case: live background tasks alone widen `display_status` to
    /// `Working` without a main turn running — that chat can still fork.
    #[test]
    fn working_from_background_tasks_alone_is_not_a_turn_in_flight() {
        let mut chat = test_chat("c1");
        chat.display_status = Some(DisplayStatus::Working);
        chat.is_running = Some(false);
        assert!(!turn_in_flight(&chat));
    }

    #[test]
    fn an_idle_chat_is_not_a_turn_in_flight() {
        let mut chat = test_chat("c1");
        chat.display_status = Some(DisplayStatus::Idle);
        chat.is_running = Some(false);
        assert!(!turn_in_flight(&chat));
    }
}
