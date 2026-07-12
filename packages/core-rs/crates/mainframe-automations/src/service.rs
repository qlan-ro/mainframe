//! `AutomationsEngine` — the Arc-shared facade (Node automations/service.ts).
//! T9.2 builds construction + the route-facing surface + `stop()`; boot
//! reconcile / sweep arming / event-source subscription land in `start()`
//! (T10.1).

use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::{Map, Value};
use tokio::task::JoinHandle;

use crate::actions::{ActionCatalogEntry, ActionRegistry};
use crate::credentials::{
    CredentialError, CredentialKind, CredentialStore, Credentials, FileCredentialStore,
};
use crate::domain::{AutomationCreateInput, ValidationError, validate};
use crate::engine::{AgentVerb, Interpreter};
use crate::error::StoreError;
use crate::interactions::{InteractionError, InteractionService};
use crate::ports::{
    AgentPort, Clock, EventSink, EventSource, Notifier, ProjectRegistry, RunSummary, to_run_summary,
};
use crate::store::{
    AutomationStore, InteractionRecord, InteractionStore, RunRecord, RunStore, RunTriggerContext,
};
use crate::triggers::{
    ScheduleSweeper, TriggerRouter, WebhookDecision, WebhookHeaders, WebhookProcessor,
};

mod build;
mod summary;
mod verb_ports;

pub use summary::AutomationSummary;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    /// Schema/scope validation failures — plain-language, per-step (T1.3).
    #[error("{}", summary::join_validation(errors))]
    Validation { errors: Vec<ValidationError> },
    #[error(transparent)]
    Store(#[from] StoreError),
}

pub struct AutomationsConfig {
    /// `<dataDir>/automations.db` (contract §3 — its own file).
    pub db_path: PathBuf,
    /// `<dataDir>/automation-credentials.json` (0600).
    pub credentials_path: PathBuf,
}

pub struct AutomationsPorts {
    pub agent: Arc<dyn AgentPort>,
    pub notifier: Arc<dyn Notifier>,
    pub events: Arc<dyn EventSink>,
    pub projects: Arc<dyn ProjectRegistry>,
    pub clock: Arc<dyn Clock>,
    /// Subscribed by `start()` (T10.1); `None` disables event triggers.
    pub event_source: Option<Arc<dyn EventSource>>,
}

pub struct AutomationsEngine {
    automations: AutomationStore,
    runs: RunStore,
    interactions: InteractionStore,
    interaction_service: InteractionService,
    interpreter: Arc<Interpreter>,
    registry: Arc<ActionRegistry>,
    credentials: Arc<FileCredentialStore>,
    webhooks: WebhookProcessor,
    #[allow(dead_code)] // armed by start() (T10.1)
    sweeper: Arc<ScheduleSweeper>,
    #[allow(dead_code)] // subscribed by start() (T10.1)
    router: Arc<TriggerRouter>,
    #[allow(dead_code)]
    event_source: Option<Arc<dyn EventSource>>,
    #[allow(dead_code)] // start() (T10.1) re-attaches watches via resume_run_watches
    agent_verb: Arc<AgentVerb>,
    clock: Arc<dyn Clock>,
    tasks: StdMutex<Vec<JoinHandle<()>>>,
}

impl AutomationsEngine {
    pub async fn new(
        config: AutomationsConfig,
        ports: AutomationsPorts,
    ) -> Result<Arc<Self>, StoreError> {
        build::build(config, ports).await
    }

    /// Ordered-shutdown hook (Node service.stop): drops the background tasks
    /// `start()` armed. Safe before `start()` and safe to call twice.
    pub fn stop(&self) {
        let tasks: Vec<JoinHandle<()>> = {
            let mut guard = self.tasks.lock().unwrap_or_else(|e| e.into_inner());
            guard.drain(..).collect()
        };
        for task in tasks {
            task.abort();
        }
    }

    // ── automations CRUD (routes/automations, T9.3) ─────────────────────────

    pub async fn list(&self) -> Result<Vec<AutomationSummary>, EngineError> {
        let records = self.automations.list().await?;
        Ok(records.iter().map(summary::to_summary).collect())
    }

    pub async fn get(&self, id: &str) -> Result<Option<AutomationSummary>, EngineError> {
        let record = self.automations.get(id).await?;
        Ok(record.as_ref().map(summary::to_summary))
    }

    pub async fn create(
        &self,
        input: AutomationCreateInput,
    ) -> Result<AutomationSummary, EngineError> {
        validated(&input)?;
        let record = self.automations.create(input).await?;
        Ok(summary::to_summary(&record))
    }

    pub async fn update(
        &self,
        id: &str,
        input: AutomationCreateInput,
    ) -> Result<AutomationSummary, EngineError> {
        validated(&input)?;
        let record = self.automations.update(id, input).await?;
        Ok(summary::to_summary(&record))
    }

    /// A4 — disabling disarms triggers (derived state: the sweep/router skip
    /// disabled rows); manual runs stay allowed (Decision 11).
    pub async fn set_enabled(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<AutomationSummary, EngineError> {
        let record = self.automations.set_enabled(id, enabled).await?;
        Ok(summary::to_summary(&record))
    }

    /// A8 — cancels every active run BEFORE the rows drop, so an in-flight
    /// advance can't keep executing against a deleted automation.
    pub async fn delete(&self, id: &str) -> Result<(), EngineError> {
        if self.automations.get(id).await?.is_none() {
            return Err(EngineError::Store(StoreError::NotFound {
                kind: "automation",
                id: id.to_string(),
            }));
        }
        for run in self.runs.list_runs(id, RUNS_PAGE).await? {
            if !run.status.is_terminal() {
                self.interpreter.cancel_run(&run.id).await?;
            }
        }
        self.automations.delete(id).await?;
        Ok(())
    }

    // ── runs ─────────────────────────────────────────────────────────────────

    pub async fn run_manually(&self, id: &str) -> Result<RunRecord, EngineError> {
        let record = self.automations.get(id).await?.ok_or_else(|| {
            EngineError::Store(StoreError::NotFound {
                kind: "automation",
                id: id.to_string(),
            })
        })?;
        let run = self
            .interpreter
            .start_run(id, record.definition, RunTriggerContext::manual(), None)
            .await?;
        let interpreter = self.interpreter.clone();
        let run_id = run.id.clone();
        tokio::spawn(async move {
            if let Err(err) = interpreter.advance(&run_id).await {
                tracing::error!(run_id, error = %err, "manual run: advance failed");
            }
        });
        Ok(run)
    }

    pub async fn list_runs(&self, automation_id: &str) -> Result<Vec<RunSummary>, EngineError> {
        let runs = self.runs.list_runs(automation_id, RUNS_PAGE).await?;
        Ok(runs.iter().map(to_run_summary).collect())
    }

    pub async fn get_run(&self, run_id: &str) -> Result<Option<RunRecord>, EngineError> {
        Ok(self.runs.get_run(run_id).await?)
    }

    pub async fn cancel_run(&self, run_id: &str) -> Result<(), EngineError> {
        if self.runs.get_run(run_id).await?.is_none() {
            return Err(EngineError::Store(StoreError::NotFound {
                kind: "automation run",
                id: run_id.to_string(),
            }));
        }
        Ok(self.interpreter.cancel_run(run_id).await?)
    }

    // ── interactions / actions / credentials / webhooks ─────────────────────

    pub async fn list_pending_interactions(&self) -> Result<Vec<InteractionRecord>, EngineError> {
        Ok(self.interactions.list_pending().await?)
    }

    pub async fn get_interaction(
        &self,
        id: &str,
    ) -> Result<Option<InteractionRecord>, EngineError> {
        Ok(self.interactions.get(id).await?)
    }

    pub async fn respond(
        &self,
        interaction_id: &str,
        payload: Map<String, Value>,
    ) -> Result<(), InteractionError> {
        self.interaction_service
            .respond(interaction_id, payload)
            .await
    }

    pub fn action_catalog(&self) -> Vec<ActionCatalogEntry> {
        self.registry.wire_catalog()
    }

    pub async fn credential_labels(&self) -> Vec<String> {
        self.credentials.labels().await
    }

    pub async fn credential_kind(&self, label: &str) -> Option<CredentialKind> {
        self.credentials.get(label).await.map(|creds| creds.kind)
    }

    pub async fn set_credential(&self, label: &str, token: String) -> Result<(), CredentialError> {
        let creds = Credentials {
            kind: CredentialKind::Token,
            token,
            extra: None,
        };
        self.credentials.set(label, creds).await
    }

    pub async fn delete_credential(&self, label: &str) -> Result<(), CredentialError> {
        self.credentials.delete(label).await
    }

    pub async fn process_webhook(
        &self,
        hook_id: &str,
        headers: &WebhookHeaders,
        raw_body: &[u8],
    ) -> WebhookDecision {
        let now_ms = self.clock.now().timestamp_millis();
        self.webhooks
            .process(hook_id, headers, raw_body, now_ms)
            .await
    }

    /// R3 — the latest matching webhook payload (in-memory sample).
    pub fn latest_webhook_sample(&self, automation_id: &str, trigger_id: &str) -> Option<Value> {
        self.webhooks.latest_sample(automation_id, trigger_id)
    }
}

const RUNS_PAGE: u32 = 50;

fn validated(input: &AutomationCreateInput) -> Result<(), EngineError> {
    let errors = validate(&input.definition);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(EngineError::Validation { errors })
    }
}

#[cfg(test)]
mod service_tests;

// PORT STATUS: packages/core/src/automations/service.ts (facade surface; arm/
// disarm is derived state here, so create/update/setEnabled need no trigger
// re-arming)
// confidence: high
// todos: 0
// notes: start()/reconcile/sweep arming land in T10.1; `tasks` is the
//        JoinHandle holder stop() drains. `agent_verb` is held for T10.1's
//        resume_run_watches.
