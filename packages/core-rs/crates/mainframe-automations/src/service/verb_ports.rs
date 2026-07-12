//! The production `VerbPorts` — the four real verbs wired together
//! (Node service.buildPorts).

use std::sync::Arc;

use crate::domain::{AskAgentStep, AskMeStep, NotifyStep, RunActionStep};
use crate::engine::{
    AgentVerb, BoxFuture, NotifyVerb, RunActionVerb, StepOutcome, VerbContext, VerbPorts,
};
use crate::interactions::AskMeVerb;

pub(super) struct EngineVerbPorts {
    pub agent: Arc<AgentVerb>,
    pub ask_me: AskMeVerb,
    pub notify: NotifyVerb,
    pub run_action: RunActionVerb,
}

impl VerbPorts for EngineVerbPorts {
    fn ask_agent<'a>(
        &'a self,
        step: &'a AskAgentStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        Box::pin(self.agent.execute(step, ctx))
    }

    fn ask_me<'a>(
        &'a self,
        step: &'a AskMeStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        Box::pin(self.ask_me.execute(step, ctx))
    }

    fn run_action<'a>(
        &'a self,
        step: &'a RunActionStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        Box::pin(self.run_action.execute(step, ctx))
    }

    fn notify<'a>(
        &'a self,
        step: &'a NotifyStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        Box::pin(self.notify.execute(step, ctx))
    }
}

// PORT STATUS: packages/core/src/automations/service.ts buildPorts (25 lines)
// confidence: high
// todos: 0
// notes: —
