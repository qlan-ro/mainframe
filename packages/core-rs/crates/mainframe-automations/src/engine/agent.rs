//! ask_agent verb + durable agent wait (T4.3, Node verbs/ask-agent.ts +
//! verbs/agent-waits.ts). The verb starts a chat, parks the step `waiting`
//! with its chatId stamped on the checkpoint entry, and spawns a watch task;
//! the settle path (agent_settle.rs) writes the outcome and re-advances.
//! Unlike Node there is no agent_waits table: the checkpoint entry IS the
//! durable record, and `resume_run_watches` re-attaches after a restart.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, MutexGuard, OnceLock};

use crate::domain::AskAgentStep;
use crate::ports::{AgentPort, AgentRequest, EventSink, WorktreeRequest};
use crate::store::{RunRecord, RunStore, StepStatus, epoch_ms_now};
use crate::tokens::render;

use super::advance::AgentWaitRegistry;
use super::checkpoint::set_step;
use super::{RunAdvancer, StepOutcome, VerbContext};

#[derive(Clone)]
pub(crate) struct WaitKey {
    pub run_id: String,
    pub step_ref: String,
}

pub struct AgentVerb {
    pub(crate) port: Arc<dyn AgentPort>,
    pub(crate) store: RunStore,
    pub(crate) events: Arc<dyn EventSink>,
    pub(crate) waits: StdMutex<HashMap<String, WaitKey>>,
    pub(crate) advancer: OnceLock<Arc<dyn RunAdvancer>>,
}

impl AgentVerb {
    pub fn new(port: Arc<dyn AgentPort>, store: RunStore, events: Arc<dyn EventSink>) -> Arc<Self> {
        Arc::new(Self {
            port,
            store,
            events,
            waits: StdMutex::new(HashMap::new()),
            advancer: OnceLock::new(),
        })
    }

    /// Two-phase init: the Interpreter owns the VerbPorts that contain this
    /// verb, so the advancer is bound after construction.
    pub fn bind_advancer(&self, advancer: Arc<dyn RunAdvancer>) {
        if self.advancer.set(advancer).is_err() {
            tracing::warn!("agent verb advancer already bound; ignoring rebind");
        }
    }

    pub async fn execute(
        self: &Arc<Self>,
        step: &AskAgentStep,
        ctx: VerbContext<'_>,
    ) -> StepOutcome {
        // Re-entry while a wait is already registered (Node findByRunStep
        // guard): keep waiting, never start a second chat.
        if self.find_chat(ctx.run_id, ctx.step_ref).is_some() {
            return StepOutcome::Wait { wake_at: None };
        }

        let request = build_request(step, &ctx);
        let handle = match self.port.start(request).await {
            Ok(handle) => handle,
            Err(err) => {
                return StepOutcome::Failed {
                    error: err.to_string(),
                };
            }
        };

        let wake_at = step
            .timeout_minutes
            .map(|minutes| epoch_ms_now() + i64::from(minutes) * 60_000);

        // Park + stamp chatId BEFORE the watch task exists, so a completion
        // can never race a still-`running` entry; the walk's own wait commit
        // afterwards is a guarded no-op re-park (checkpoint::park_step).
        let (step_ref, step_id) = (ctx.step_ref.to_string(), step.id.clone());
        let chat_id = handle.chat_id.clone();
        let parked = self
            .store
            .patch_checkpoint(ctx.run_id, move |cp| {
                set_step(
                    cp,
                    &step_ref,
                    &step_id,
                    "ask_agent",
                    StepStatus::Waiting,
                    None,
                    None,
                );
                if let Some(entry) = cp.steps.get_mut(&step_ref) {
                    entry.chat_id = Some(chat_id);
                }
                cp.wake_at = wake_at;
            })
            .await;
        if let Err(err) = parked {
            // Cancel raced the chat start: stop the orphaned chat, park —
            // the walk's own commit hits the same A8 guard and unwinds.
            tracing::warn!(run_id = ctx.run_id, error = %err, "agent park rejected; cancelling chat");
            self.spawn_chat_cancel(handle.chat_id);
            return StepOutcome::Wait { wake_at: None };
        }

        self.register(&handle.chat_id, ctx.run_id, ctx.step_ref);
        self.spawn_watch(handle.chat_id);
        StepOutcome::Wait { wake_at }
    }

    /// Boot/restart path: re-attach a watch for every `waiting` ask_agent
    /// entry (its chatId is on the checkpoint — the wait is durable).
    pub fn resume_run_watches(self: &Arc<Self>, run: &RunRecord) {
        if run.status.is_terminal() {
            return;
        }
        for (step_ref, entry) in &run.checkpoint.steps {
            if entry.status != StepStatus::Waiting || entry.kind != "ask_agent" {
                continue;
            }
            let Some(chat_id) = &entry.chat_id else {
                // Unreachable by construction (waiting is committed with the
                // chatId in one patch); log instead of guessing.
                tracing::error!(
                    run_id = run.id,
                    step_ref,
                    "waiting ask_agent entry has no chatId"
                );
                continue;
            };
            if self.wait_key(chat_id).is_some() {
                continue;
            }
            self.register(chat_id, &run.id, step_ref);
            self.spawn_watch(chat_id.clone());
        }
    }

    fn spawn_watch(self: &Arc<Self>, chat_id: String) {
        let verb = self.clone();
        tokio::spawn(async move {
            let outcome = verb.port.watch(&chat_id).await;
            verb.settle(&chat_id, outcome).await;
        });
    }

    fn spawn_chat_cancel(&self, chat_id: String) {
        let port = self.port.clone();
        tokio::spawn(async move {
            if let Err(err) = port.cancel(&chat_id).await {
                tracing::warn!(chat_id, error = %err, "agent chat cancel failed");
            }
        });
    }

    fn register(&self, chat_id: &str, run_id: &str, step_ref: &str) {
        self.lock_waits().insert(
            chat_id.to_string(),
            WaitKey {
                run_id: run_id.to_string(),
                step_ref: step_ref.to_string(),
            },
        );
    }

    pub(crate) fn wait_key(&self, chat_id: &str) -> Option<WaitKey> {
        self.lock_waits().get(chat_id).cloned()
    }

    pub(crate) fn remove_wait(&self, chat_id: &str) {
        self.lock_waits().remove(chat_id);
    }

    fn find_chat(&self, run_id: &str, step_ref: &str) -> Option<String> {
        self.lock_waits()
            .iter()
            .find(|(_, key)| key.run_id == run_id && key.step_ref == step_ref)
            .map(|(chat_id, _)| chat_id.clone())
    }

    /// Poisoned-map recovery matches advance.rs's lock_map rationale.
    fn lock_waits(&self) -> MutexGuard<'_, HashMap<String, WaitKey>> {
        self.waits
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// A8: cancel_run purges the run's registrations in the same pass, so a chat
/// that finishes later finds nothing to wake — and the chat itself is told
/// to stop (best-effort).
impl AgentWaitRegistry for AgentVerb {
    fn clear_for_run(&self, run_id: &str) {
        let cleared: Vec<String> = {
            let mut waits = self.lock_waits();
            let chat_ids: Vec<String> = waits
                .iter()
                .filter(|(_, key)| key.run_id == run_id)
                .map(|(chat_id, _)| chat_id.clone())
                .collect();
            for chat_id in &chat_ids {
                waits.remove(chat_id);
            }
            chat_ids
        };
        for chat_id in cleared {
            self.spawn_chat_cancel(chat_id);
        }
    }
}

fn build_request(step: &AskAgentStep, ctx: &VerbContext<'_>) -> AgentRequest {
    let expects = step.expects.clone().unwrap_or_default();
    AgentRequest {
        prompt: render(&step.prompt, ctx.scope),
        adapter_id: step
            .adapter_id
            .clone()
            .unwrap_or_else(|| "claude".to_string()),
        model: step.model.clone(),
        permission_mode: step.permission_mode.clone(),
        project_id: step.project_id.clone(),
        worktree: step.worktree.as_ref().map(|worktree| WorktreeRequest {
            base_branch: worktree.base_branch.clone(),
            branch_name: render(&worktree.branch_name, ctx.scope),
        }),
        auto_approve: step.auto_approve.clone(),
        timeout_minutes: step.timeout_minutes,
        expects,
        attachments: step.attachments.clone().unwrap_or_default(),
    }
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.3), not a TS port
// confidence: high
// todos: 0
// notes: no agent_waits table (contract §3: engine-internal caches are not
//        contract) — the checkpoint entry's chatId is the durable record;
//        settle/judge live in agent_settle.rs (300-line file cap).
