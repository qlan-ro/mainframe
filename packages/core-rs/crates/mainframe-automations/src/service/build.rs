//! Engine assembly: stores → registry → verbs → interpreter → interaction
//! service → trigger plumbing.

use std::sync::{Arc, Mutex as StdMutex};

use crate::actions::{ActionRegistry, register_all_actions};
use crate::credentials::RefreshingCredentialStore;
use crate::engine::{AgentVerb, Interpreter, InterpreterDeps, NotifyVerb, RunActionVerb};
use crate::error::StoreError;
use crate::interactions::{AskMeVerb, InteractionService};
use crate::store::{AutomationDb, AutomationStore, InteractionStore, RunStore, WebhookStateStore};
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

    let registry = action_registry(ports.registry.clone())?;
    let credentials = config.credentials;
    // Only the execution path needs expiry-refresh — the admin/UI accessor
    // (`AutomationsEngine::credentials()`) and webhook secrets keep reading
    // `credentials` raw.
    let refreshing_credentials = Arc::new(RefreshingCredentialStore::new(
        credentials.clone(),
        ports.clock.clone(),
    ));

    let (agent_verb, interpreter, completion) = build_interpreter(
        &ports,
        &runs,
        &interactions,
        &automations,
        registry.clone(),
        refreshing_credentials,
    );

    let (router, sweeper) = trigger_services(&automations, &interpreter, &agent_verb, &completion);
    let webhook_deliveries = WebhookStateStore::new(db);
    let webhooks = WebhookProcessor::new(
        automations.clone(),
        credentials.clone(),
        interpreter.clone(),
        webhook_deliveries.clone(),
    );

    Ok(Arc::new(AutomationsEngine {
        automations,
        runs,
        interactions: interactions.clone(),
        interaction_service: InteractionService::new(
            interactions.clone(),
            interpreter.clone(),
            ports.events.clone(),
        ),
        interpreter,
        registry,
        credentials,
        webhooks,
        webhook_deliveries,
        sweeper,
        router,
        event_source: ports.event_source,
        agent_verb,
        clock: ports.clock,
        tasks: StdMutex::new(Vec::new()),
        started: std::sync::atomic::AtomicBool::new(false),
    }))
}

fn build_interpreter(
    ports: &AutomationsPorts,
    runs: &RunStore,
    interactions: &InteractionStore,
    automations: &AutomationStore,
    registry: Arc<ActionRegistry>,
    refreshing_credentials: Arc<RefreshingCredentialStore>,
) -> (Arc<AgentVerb>, Arc<Interpreter>, Arc<CompletionEmitter>) {
    let agent_verb = AgentVerb::new(ports.agent.clone(), runs.clone());
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
            refreshing_credentials,
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

    (agent_verb, interpreter, completion)
}

fn action_registry(
    registry: Option<Arc<ActionRegistry>>,
) -> Result<Arc<ActionRegistry>, StoreError> {
    let registry = match registry {
        Some(registry) => registry,
        None => {
            let mut registry = ActionRegistry::new();
            register_all_actions(&mut registry).map_err(StoreError::ActionRegistry)?;
            Arc::new(registry)
        }
    };
    Ok(registry)
}

fn trigger_services(
    automations: &AutomationStore,
    interpreter: &Arc<Interpreter>,
    agent_verb: &Arc<AgentVerb>,
    completion: &Arc<CompletionEmitter>,
) -> (Arc<TriggerRouter>, Arc<ScheduleSweeper>) {
    let firer = Arc::new(TriggerFirer::new(automations.clone(), interpreter.clone()));
    let router = Arc::new(TriggerRouter::new(
        automations.clone(),
        firer.clone(),
        Some(agent_verb.clone()),
    ));
    completion.bind_router(router.clone());
    let sweeper = Arc::new(ScheduleSweeper::new(automations.clone(), firer));
    (router, sweeper)
}
