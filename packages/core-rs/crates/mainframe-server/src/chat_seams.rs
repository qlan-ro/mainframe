//! Phase-5 seam traits for the subsystems the `ChatManager` depends on that are
//! not yet ported (the `mainframe-launch` crate). The `ChatManagerDeps` methods
//! that reach these subsystems delegate to the seam so, when Phase 5 lands, the
//! real `LaunchRegistry` slots in behind the same trait with no change to the
//! wired `DaemonChatDeps`.
//!
//! Only launch is stubbed here. The other subsystems the task flagged as
//! Phase-5-shaped (notifications, per-chat todos, push) turned out to be already
//! ported — `mainframe_services::notifications`, `db.chats.update_todos`, and
//! `mainframe_services::push::PushService` — so `DaemonChatDeps` wires them to the
//! real implementations rather than stubbing them (stubbing ported behaviour would
//! *reduce* fidelity). See `chat_deps.rs`.

use std::sync::Arc;

use mainframe_adapter_api::BoxFuture;

/// The launch-process control surface the `ChatManager` needs before it tears
/// down a worktree (`chats.setStopLaunchProcesses` in `index.ts`). Mirrors the
/// single call the TS makes: `const m = launchRegistry.get(projectId, path);
/// if (m) await m.stopAll();`.
///
/// TODO(port-phase5): replace `NoopLaunchStopper` with an impl backed by the
/// ported `mainframe-launch::LaunchRegistry`.
pub trait LaunchStopper: Send + Sync {
    /// Stop every launch process bound to `(project_id, effective_path)`. Returns
    /// `None` when there is no launch manager for that scope — faithful to the TS
    /// `if (m)` guard (no configs → nothing to stop).
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>>;
}

/// The Phase-4 default: no launch registry exists yet, so there is never a
/// manager to stop. Matches `chats.setStopLaunchProcesses` never having been
/// wired (the TS `stopLaunchProcesses` stays `undefined`).
pub struct NoopLaunchStopper;

impl LaunchStopper for NoopLaunchStopper {
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        tracing::debug!(
            project_id,
            effective_path,
            "stopLaunchProcesses seam: launch registry not ported (Phase 5) — no-op"
        );
        None
    }
}

/// Convenience constructor for the boot path.
pub fn default_launch_stopper() -> Arc<dyn LaunchStopper> {
    Arc::new(NoopLaunchStopper)
}

// PORT STATUS: (new — Phase-5 launch seam for chat/index.ts setStopLaunchProcesses)
// confidence: high
// todos: 1
// notes: Only `mainframe-launch` is genuinely unported among the subsystems the
// ChatManager touches, so it is the only seam here (NoopLaunchStopper → None,
// matching the TS `if (m)` guard when no launch manager exists). notifications /
// per-chat todos / push are already ported and wired to the real impls in
// chat_deps.rs, not stubbed.
