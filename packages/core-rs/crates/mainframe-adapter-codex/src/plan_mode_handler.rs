//! Port target for `packages/core/src/plugins/builtin/codex/plan-mode-handler.ts`.
//!
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

// PORT STATUS: src/plugins/builtin/codex/plan-mode-handler.ts (84 lines)
// confidence: low
// todos: 1
// notes: structural blocker (the PlanModeActionHandler/PlanActionContext traits and
// notes: the Adapter::create_plan_mode_handler seam) is resolved — both now exist and
// notes: are exercised by mainframe-chat's Claude wiring. Remaining gap is purely
// notes: behavioral: onApprove/onApproveAndClearContext/onReject/onRevise + the
// notes: plan-mode-handler.test.ts port. Ships as a unit struct returned by the
// notes: inherent CodexAdapter::create_plan_mode_handler; the Adapter trait override
// notes: stays on its default (None) until the four methods land. TODO(port).
