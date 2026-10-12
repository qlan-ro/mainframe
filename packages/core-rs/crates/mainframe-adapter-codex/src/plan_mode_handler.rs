//! The `PlanModeActionHandler`/`PlanActionContext` traits and the `Adapter::
//! create_plan_mode_handler` seam this handler needs all exist
//! (`mainframe_adapter_api::plan_mode_actions`, wired for Claude in
//! `mainframe-chat`). This type doesn't implement `PlanModeActionHandler` yet,
//! so `CodexAdapter` deliberately keeps the trait's default
//! `create_plan_mode_handler` (`None`) rather than returning a handler with no
//! logic. The four action methods (approve / approve-and-clear-context /
//! reject / revise) are still a behavioral TODO.
//!
//! `CodexAdapter::create_plan_mode_handler` (an inherent method, not the trait
//! override) already returns this unit type; wiring it into the trait comes with
//! those four methods.

/// Codex plan-mode handler. See the module note — the four
/// `PlanModeActionHandler` methods are not implemented yet; `CodexAdapter` does
/// not yet expose this via the `Adapter::create_plan_mode_handler` trait method.
#[derive(Debug, Default, Clone, Copy)]
pub struct CodexPlanModeHandler;

impl CodexPlanModeHandler {
    pub fn new() -> Self {
        Self
    }
}
