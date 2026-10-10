//! The `PlanModeActionHandler`/`PlanActionContext` traits and the `Adapter::
//! create_plan_mode_handler` seam this handler needs now all exist
//! (`mainframe_adapter_api::plan_mode_actions`, wired for Claude in
//! `mainframe-chat`). What remains is behavioral, not structural: this type
//! doesn't implement `PlanModeActionHandler` yet, so `CodexAdapter` deliberately
//! keeps the trait's default `create_plan_mode_handler` (`None`) rather than
//! returning a handler with unported logic. The four action methods (onApprove /
//! onApproveAndClearContext / onReject / onRevise) and `plan-mode-handler.test.ts`
//! are still an unported behavioral TODO.
//!
//! `CodexAdapter::create_plan_mode_handler` (an inherent method, not the trait
//! override) already returns this unit type — wiring it into the trait is part of
//! the same deferred phase.

/// Codex plan-mode handler. See the module note — the behavioral port (the four
/// `PlanModeActionHandler` methods) is still deferred; `CodexAdapter` does not yet
/// expose this via the `Adapter::create_plan_mode_handler` trait method.
#[derive(Debug, Default, Clone, Copy)]
pub struct CodexPlanModeHandler;

impl CodexPlanModeHandler {
    pub fn new() -> Self {
        Self
    }
}
