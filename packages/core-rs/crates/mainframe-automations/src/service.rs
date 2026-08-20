//! `AutomationsEngine` — the Arc-shared facade (Node automations/service.ts).
//! T9.2 builds construction + the route-facing surface + `stop()`; boot
//! reconcile / sweep arming / event-source subscription land in `start()`
//! (T10.1).

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex as StdMutex};

use serde_json::{Map, Value};
use tokio::task::JoinHandle;

use crate::actions::{ActionCatalogEntry, ActionRegistry};
use crate::credentials::{CredentialError, CredentialKind, CredentialStore, Credentials};
use crate::domain::{AutomationCreateInput, ValidationError, ValidationLevel, validate};
use crate::engine::{AgentVerb, Interpreter};
use crate::error::StoreError;
use crate::interactions::{InteractionError, InteractionService};
use crate::ports::{AgentPort, Clock, EventSink, EventSource, Notifier, ProjectRegistry};
use crate::store::{
    AutomationStore, InteractionRecord, InteractionStore, RunStore, WebhookStateStore,
};
use crate::triggers::{
    ScheduleSweeper, TriggerRouter, WebhookDecision, WebhookHeaders, WebhookProcessor,
};

mod build;
mod registration;
mod runs;
mod start;
mod summary;
mod verb_ports;

pub use registration::WebhookState;
pub use start::StartError;
pub use summary::AutomationSummary;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    /// Schema/scope validation failures — plain-language, per-step (T1.3).
    #[error("{}", summary::join_validation(errors))]
    Validation { errors: Vec<ValidationError> },
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Credential(#[from] CredentialError),
}

pub struct AutomationsConfig {
    /// `<dataDir>/automations.db` (contract §3 — its own file).
    pub db_path: PathBuf,
    /// Built by the caller — production boots via
    /// `credentials::build_credential_store` (keychain, falling back to the
    /// legacy `<dataDir>/automation-credentials.json`); tests build a bare
    /// `FileCredentialStore` over a tempdir so they never touch a real
    /// keychain.
    pub credentials: Arc<dyn CredentialStore>,
}

pub struct AutomationsPorts {
    pub agent: Arc<dyn AgentPort>,
    pub notifier: Arc<dyn Notifier>,
    pub events: Arc<dyn EventSink>,
    pub projects: Arc<dyn ProjectRegistry>,
    pub clock: Arc<dyn Clock>,
    /// Subscribed by `start()` (T10.1); `None` disables event triggers.
    pub event_source: Option<Arc<dyn EventSource>>,
    /// Test seam (T10.2): a pre-built action registry. `None` → the launch
    /// catalog (`register_all_actions`). Production always passes `None`; the
    /// conformance suite injects recording fakes so a run never touches real
    /// GitHub/Notion HTTP or the user's home directory.
    pub registry: Option<Arc<ActionRegistry>>,
}

pub struct AutomationsEngine {
    automations: AutomationStore,
    runs: RunStore,
    interactions: InteractionStore,
    interaction_service: InteractionService,
    interpreter: Arc<Interpreter>,
    registry: Arc<ActionRegistry>,
    credentials: Arc<dyn CredentialStore>,
    webhooks: WebhookProcessor,
    /// T7 — the durable half of webhook state (the sample index is memory).
    webhook_deliveries: WebhookStateStore,
    /// Armed by `start()` — the 30 s derived-state schedule driver.
    sweeper: Arc<ScheduleSweeper>,
    /// Subscribed by `start()` when an `event_source` is present.
    router: Arc<TriggerRouter>,
    event_source: Option<Arc<dyn EventSource>>,
    /// `start()` re-attaches watches via `resume_run_watches`.
    agent_verb: Arc<AgentVerb>,
    clock: Arc<dyn Clock>,
    /// Long-lived background tasks (`start()` arms the sweep + event loop;
    /// `stop()` aborts them).
    tasks: StdMutex<Vec<JoinHandle<()>>>,
    /// One-shot latch so a second `start()` is a typed error, not a
    /// double-armed sweep / duplicate reconcile.
    started: AtomicBool,
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
        mut input: AutomationCreateInput,
    ) -> Result<AutomationSummary, EngineError> {
        registration::strip(&mut input.definition);
        validated(&input)?;
        let record = self.automations.create(input).await?;
        Ok(summary::to_summary(&record))
    }

    pub async fn update(
        &self,
        id: &str,
        mut input: AutomationCreateInput,
    ) -> Result<AutomationSummary, EngineError> {
        registration::strip(&mut input.definition);
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
        for run in self.runs.list_runs(id, runs::RUNS_PAGE).await? {
            if !run.status.is_terminal() {
                self.interpreter.cancel_run(&run.id).await?;
            }
        }
        self.automations.delete(id).await?;
        Ok(())
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

    pub async fn action_catalog(&self) -> Vec<ActionCatalogEntry> {
        self.registry.wire_catalog().await
    }

    pub async fn credential_labels(&self) -> Vec<String> {
        self.credentials.labels().await
    }

    pub async fn credential_kind(&self, label: &str) -> Option<CredentialKind> {
        self.credentials.get(label).await.map(|creds| creds.kind)
    }

    pub async fn set_credential(&self, label: &str, token: String) -> Result<(), CredentialError> {
        self.set_credential_full(label, token, None, None).await
    }

    /// Used by the GitHub device-flow route to persist a GitHub-App token's
    /// refresh material alongside it; every other caller (a pasted PAT) goes
    /// through `set_credential` above, which leaves both fields `None`.
    pub async fn set_credential_full(
        &self,
        label: &str,
        token: String,
        refresh_token: Option<String>,
        expires_at: Option<i64>,
    ) -> Result<(), CredentialError> {
        let creds = Credentials {
            kind: CredentialKind::Token,
            token,
            extra: None,
            refresh_token,
            expires_at,
        };
        self.credentials.set(label, creds).await
    }

    /// The store the link dialog writes through (`set_credential` above), for
    /// callers outside this crate (the GitHub port adapter). The only other
    /// permitted credential source: a second store built at boot would cache
    /// its own snapshot and never see a token connected after startup.
    pub fn credentials(&self) -> Arc<dyn CredentialStore> {
        self.credentials.clone()
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

    /// T7 — provisions the hook's signing secret and reports its delivery
    /// state. `None` when the automation or the webhook trigger is gone.
    pub async fn arm_webhook(
        &self,
        automation_id: &str,
        trigger_id: &str,
    ) -> Result<Option<WebhookState>, EngineError> {
        registration::arm(self, automation_id, trigger_id).await
    }

    /// T7 — the registration state of an already-armed hook, for embedding on
    /// read. `None` for a hook nobody has registered.
    pub async fn webhook_state(&self, hook_id: &str) -> Result<Option<WebhookState>, EngineError> {
        registration::read(self, hook_id).await
    }

    /// R3 — the latest matching webhook payload (in-memory sample).
    pub fn latest_webhook_sample(&self, automation_id: &str, trigger_id: &str) -> Option<Value> {
        self.webhooks.latest_sample(automation_id, trigger_id)
    }
}

fn validated(input: &AutomationCreateInput) -> Result<(), EngineError> {
    // A rejection carries only what blocks it. Warnings never block — the
    // editor computes and shows its own beside a working Save button, and a
    // client that treats every returned issue as fatal would wedge on one.
    let errors: Vec<_> = validate(&input.definition)
        .into_iter()
        .filter(|e| e.level == ValidationLevel::Error)
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(EngineError::Validation { errors })
    }
}

#[cfg(test)]
mod credentials_accessor_tests;
#[cfg(test)]
mod registration_tests;
#[cfg(test)]
mod service_tests;

// PORT STATUS: packages/core/src/automations/service.ts (facade surface; arm/
// disarm is derived state here, so create/update/setEnabled need no trigger
// re-arming)
// confidence: high
// todos: 0
// notes: start()/reconcile/sweep arming live in service/start.rs; `tasks` is
//        the JoinHandle holder stop() drains; `agent_verb` re-attaches watches
//        via resume_run_watches during reconcile.
