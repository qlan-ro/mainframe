//! Port target for `packages/core/src/plugins/builtin/codex/plan-mode-handler.ts`.
//!
//! BLOCKED (see the crate's task blockers): the TS `CodexPlanModeHandler`
//! implements `PlanModeActionHandler` over a `PlanActionContext`, both defined in
//! `packages/core/src/chat/plan-mode-actions.ts` → `mainframe_chat::plan_mode_actions`
//! — which is still a skeleton (owned by the mainframe-chat port task, not this one).
//! Until that trait + context land there is no trait slot to implement against
//! (the `mainframe_adapter_api::Adapter` trait also has no `createPlanModeHandler`
//! seam yet — it is in that crate's `TODO(port)`).
//!
//! We ship the handler as a unit type now so `CodexAdapter::create_plan_mode_handler`
//! has something to return; the four action methods (onApprove /
//! onApproveAndClearContext / onReject / onRevise) and `plan-mode-handler.test.ts`
//! are deferred to the phase that ports `mainframe-chat::plan_mode_actions`.

/// Codex plan-mode handler. See the module blocker note — the behavioral port is
/// deferred until `mainframe_chat::plan_mode_actions::{PlanModeActionHandler,
/// PlanActionContext}` exist.
#[derive(Debug, Default, Clone, Copy)]
pub struct CodexPlanModeHandler;

impl CodexPlanModeHandler {
    pub fn new() -> Self {
        Self
    }
}

// PORT STATUS: src/plugins/builtin/codex/plan-mode-handler.ts (84 lines)
// confidence: low
// todos: 1
// notes: BLOCKER — depends on mainframe_chat::plan_mode_actions (PlanModeActionHandler
// notes: trait + PlanActionContext), currently a skeleton owned by the mainframe-chat
// notes: task; and on a `createPlanModeHandler` seam on mainframe_adapter_api::Adapter
// notes: (that crate's own TODO(port)). Ships as a unit struct so the adapter can
// notes: return it; onApprove/onApproveAndClearContext/onReject/onRevise + the
// notes: plan-mode-handler.test.ts port are deferred to that phase. TODO(port).
