//! Shared fakes + builders for the engine tests (in-crate until the testkit
//! feature phase exposes them to mainframe-server tests).

use std::sync::{Arc, Mutex};

use chrono::{DateTime, FixedOffset};
use serde_json::{Map, Value};
use tempfile::TempDir;

use crate::domain::{
    AskAgentStep, AskMeStep, AutomationCreateInput, AutomationDefinition, AutomationScope,
    ChipPart, ChipText, NotifyStep, RunActionStep, Step, TokenRef,
};
use crate::ports::{AutomationEvent, Clock, EventSink, RunSummary};
use crate::store::{AutomationDb, AutomationStore, InteractionStore, RunStore, RunTriggerContext};

use super::advance::{Interpreter, InterpreterDeps};
use super::{BoxFuture, StepOutcome, VerbContext, VerbPorts};

pub(crate) struct FakeClock;

impl Clock for FakeClock {
    fn now(&self) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339("2026-07-12T10:00:00+02:00").unwrap()
    }
}

#[derive(Default)]
pub(crate) struct CollectingSink {
    pub events: Mutex<Vec<AutomationEvent>>,
}

impl EventSink for CollectingSink {
    fn emit(&self, event: AutomationEvent) {
        self.events.lock().unwrap().push(event);
    }
}

impl CollectingSink {
    pub fn run_updates(&self) -> Vec<RunSummary> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|e| match e {
                AutomationEvent::RunUpdated { run } => run.clone(),
            })
            .collect()
    }
}

type Handler<S> = Box<dyn Fn(&S, &VerbContext<'_>) -> StepOutcome + Send + Sync>;

fn never<S>(name: &'static str) -> Handler<S> {
    Box::new(move |_, _| panic!("unexpected call to VerbPorts.{name}"))
}

/// Node test parity: every verb panics unless the test installs a handler.
pub(crate) struct FakePorts {
    pub ask_agent: Handler<AskAgentStep>,
    pub ask_me: Handler<AskMeStep>,
    pub run_action: Handler<RunActionStep>,
    pub notify: Handler<NotifyStep>,
}

impl Default for FakePorts {
    fn default() -> Self {
        Self {
            ask_agent: never("ask_agent"),
            ask_me: never("ask_me"),
            run_action: never("run_action"),
            notify: never("notify"),
        }
    }
}

impl VerbPorts for FakePorts {
    fn ask_agent<'a>(
        &'a self,
        step: &'a AskAgentStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        let out = (self.ask_agent)(step, &ctx);
        Box::pin(async move { out })
    }

    fn ask_me<'a>(
        &'a self,
        step: &'a AskMeStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        let out = (self.ask_me)(step, &ctx);
        Box::pin(async move { out })
    }

    fn run_action<'a>(
        &'a self,
        step: &'a RunActionStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        let out = (self.run_action)(step, &ctx);
        Box::pin(async move { out })
    }

    fn notify<'a>(
        &'a self,
        step: &'a NotifyStep,
        ctx: VerbContext<'a>,
    ) -> BoxFuture<'a, StepOutcome> {
        let out = (self.notify)(step, &ctx);
        Box::pin(async move { out })
    }
}

pub(crate) struct Harness {
    pub _dir: TempDir,
    pub db: AutomationDb,
    pub store: RunStore,
    pub interactions: InteractionStore,
    pub automation_id: String,
    pub sink: Arc<CollectingSink>,
}

pub(crate) async fn harness() -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let db = AutomationDb::open(dir.path().join("automations.db"))
        .await
        .unwrap();
    let automations = AutomationStore::new(db.clone());
    let record = automations
        .create(AutomationCreateInput {
            name: "A".to_string(),
            description: None,
            scope: AutomationScope::Global,
            project_id: None,
            definition: definition(vec![]),
        })
        .await
        .unwrap();
    Harness {
        db: db.clone(),
        store: RunStore::new(db.clone()),
        interactions: InteractionStore::new(db),
        automation_id: record.id,
        sink: Arc::new(CollectingSink::default()),
        _dir: dir,
    }
}

impl Harness {
    pub fn interpreter(&self, ports: impl VerbPorts + 'static) -> Interpreter {
        Interpreter::new(self.deps(ports))
    }

    pub fn deps(&self, ports: impl VerbPorts + 'static) -> InterpreterDeps {
        InterpreterDeps {
            store: self.store.clone(),
            ports: Arc::new(ports),
            events: self.sink.clone(),
            clock: Arc::new(FakeClock),
            is_idempotent: None,
            agent_waits: None,
        }
    }
}

pub(crate) fn definition(steps: Vec<Step>) -> AutomationDefinition {
    AutomationDefinition {
        triggers: vec![],
        steps,
    }
}

pub(crate) fn manual() -> RunTriggerContext {
    RunTriggerContext::manual()
}

pub(crate) fn text(s: &str) -> ChipPart {
    ChipPart::Text(s.to_string())
}

pub(crate) fn token(step_id: &str, output: &str, field: Option<&str>) -> ChipPart {
    ChipPart::Token {
        token: TokenRef {
            step_id: step_id.to_string(),
            output: output.to_string(),
            field: field.map(str::to_string),
        },
    }
}

pub(crate) fn notify_step(id: &str, message: ChipText) -> Step {
    Step::Notify(NotifyStep {
        id: id.to_string(),
        keep_going: false,
        message,
    })
}

pub(crate) fn run_action_step(id: &str, action_id: &str, keep_going: bool) -> Step {
    Step::RunAction(RunActionStep {
        id: id.to_string(),
        keep_going,
        action_id: action_id.to_string(),
        credential: None,
        params: Default::default(),
        output_as: None,
    })
}

pub(crate) fn ask_me_step(id: &str) -> Step {
    Step::AskMe(AskMeStep {
        id: id.to_string(),
        keep_going: false,
        title: "Pick one".to_string(),
        fields: vec![],
    })
}

pub(crate) fn ask_agent_step(id: &str, keep_going: bool) -> Step {
    Step::AskAgent(AskAgentStep {
        id: id.to_string(),
        keep_going,
        prompt: vec![text("go")],
        adapter_id: None,
        model: None,
        permission_mode: None,
        project_id: None,
        worktree: None,
        auto_approve: None,
        timeout_minutes: None,
        expects: None,
        attachments: None,
    })
}

pub(crate) fn completed(outputs: Map<String, Value>) -> StepOutcome {
    StepOutcome::Completed { outputs }
}

pub(crate) fn empty_outputs() -> Map<String, Value> {
    Map::new()
}
