//! Engine assembly (Node AutomationService constructor): stores → registry →
//! verbs → interpreter → interaction service → trigger plumbing.

use std::sync::{Arc, Mutex as StdMutex};

use crate::actions::{ActionRegistry, register_all_actions};
use crate::credentials::FileCredentialStore;
use crate::engine::{AgentVerb, Interpreter, InterpreterDeps, NotifyVerb, RunActionVerb};
use crate::error::StoreError;
use crate::interactions::{AskMeVerb, InteractionService};
use crate::store::{AutomationDb, AutomationStore, InteractionStore, RunStore};
use crate::triggers::{
    CompletionEmitter, ScheduleSweeper, TriggerFirer, TriggerRouter, WebhookProcessor,
};

use super::verb_ports::EngineVerbPorts;
use super::{AutomationsConfig, AutomationsEngine, AutomationsPorts};

pub(super) async fn build(
    config: AutomationsConfig,
    ports: AutomationsPorts,
) -> Result<Arc<AutomationsEngine>, StoreError> {
    let db = AutomationDb::open(&config.db_path).await?;
    let automations = AutomationStore::new(db.clone());
    let runs = RunStore::new(db.clone());
    let interactions = InteractionStore::new(db.clone());

    let registry = match ports.registry {
        Some(registry) => registry,
        None => {
            let mut registry = ActionRegistry::new();
            register_all_actions(&mut registry)
                .map_err(|err| StoreError::Task(format!("action registry: {}", err.0)))?;
            Arc::new(registry)
        }
    };
    let credentials = Arc::new(FileCredentialStore::load(config.credentials_path).await);

    let agent_verb = AgentVerb::new(ports.agent, runs.clone(), ports.events.clone());
    let verb_ports = EngineVerbPorts {
        agent: agent_verb.clone(),
        ask_me: AskMeVerb::new(
            interactions.clone(),
            runs.clone(),
            automations.clone(),
            ports.events.clone(),
            ports.notifier.clone(),
        ),
        notify: NotifyVerb::new(runs.clone(), automations.clone(), ports.notifier.clone()),
        run_action: RunActionVerb::new(
            registry.clone(),
            credentials.clone(),
            ports.projects.clone(),
            runs.clone(),
            automations.clone(),
        ),
    };

    let completion = CompletionEmitter::new(automations.clone(), ports.events.clone());
    let is_idempotent = {
        let registry = registry.clone();
        move |step: &crate::domain::RunActionStep| registry.is_idempotent(&step.action_id)
    };
    let interpreter = Arc::new(Interpreter::new(InterpreterDeps {
        store: runs.clone(),
        ports: Arc::new(verb_ports),
        events: ports.events.clone(),
        clock: ports.clock.clone(),
        is_idempotent: Some(Arc::new(is_idempotent)),
        agent_waits: Some(agent_verb.clone()),
        on_finalized: Some(completion.clone()),
    }));
    agent_verb.bind_advancer(interpreter.clone());

    let interaction_service = InteractionService::new(
        interactions.clone(),
        interpreter.clone(),
        ports.events.clone(),
    );
    let firer = Arc::new(TriggerFirer::new(automations.clone(), interpreter.clone()));
    let router = Arc::new(TriggerRouter::new(
        automations.clone(),
        firer.clone(),
        Some(agent_verb.clone()),
    ));
    completion.bind_router(router.clone());
    let sweeper = Arc::new(ScheduleSweeper::new(automations.clone(), firer));
    let webhooks = WebhookProcessor::new(
        automations.clone(),
        credentials.clone(),
        interpreter.clone(),
    );

    Ok(Arc::new(AutomationsEngine {
        automations,
        runs,
        interactions,
        interaction_service,
        interpreter,
        registry,
        credentials,
        webhooks,
        sweeper,
        router,
        event_source: ports.event_source,
        agent_verb,
        clock: ports.clock,
        tasks: StdMutex::new(Vec::new()),
        started: std::sync::atomic::AtomicBool::new(false),
    }))
}

// PORT STATUS: packages/core/src/automations/service.ts (constructor)
// confidence: high
// todos: 0
// notes: —
