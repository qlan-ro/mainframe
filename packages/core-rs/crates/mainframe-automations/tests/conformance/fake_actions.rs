//! Recording action registry for the conformance harness (T10.2). The engine
//! runs its REAL run_action verb; only the actions themselves are faked, so a
//! run never hits real GitHub/Notion HTTP or the user's home directory. Each
//! fake records the rendered params it received (so a scenario asserts token
//! wiring precisely) and can be `hold()`-gated mid-effect to model a crash /
//! cancel while a step is `running` (T10.3). Idempotent flags mirror the real
//! catalog so the restart policy behaves identically.
#![allow(dead_code)]

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::sync::Notify;

use mainframe_automations::actions::{
    Action, ActionAuth, ActionCtx, ActionError, ActionGroup, ActionManifest, ActionOutputs,
    ActionRegistry,
};
use mainframe_automations::engine::BoxFuture;
use mainframe_automations::tokens::TokenValue;

/// A mid-effect barrier. Open by default (pass-through); once `hold()`, the
/// next `execute` blocks at the gate until `release()` — long enough for a
/// scenario to drop/cancel the run while the step is `running`.
#[derive(Default)]
pub struct Gate {
    held: AtomicBool,
    notify: Notify,
}

impl Gate {
    pub fn hold(&self) {
        self.held.store(true, Ordering::SeqCst);
    }

    pub fn release(&self) {
        self.held.store(false, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    async fn pass(&self) {
        loop {
            let fut = self.notify.notified();
            if !self.held.load(Ordering::SeqCst) {
                return;
            }
            fut.await;
        }
    }
}

/// Every fake action appends `(action_id, rendered_params)` here.
#[derive(Clone, Default)]
pub struct ActionRecorder {
    calls: Arc<Mutex<Vec<(String, Value)>>>,
}

impl ActionRecorder {
    pub fn calls_for(&self, action_id: &str) -> Vec<Value> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(id, _)| id == action_id)
            .map(|(_, params)| params.clone())
            .collect()
    }

    pub fn count(&self, action_id: &str) -> usize {
        self.calls_for(action_id).len()
    }
}

struct RecordingAction {
    id: &'static str,
    group: ActionGroup,
    auth: ActionAuth,
    idempotent: bool,
    outputs: ActionOutputs,
    recorder: ActionRecorder,
    gate: Arc<Gate>,
}

impl Action for RecordingAction {
    fn manifest(&self) -> ActionManifest {
        ActionManifest {
            id: self.id,
            title: self.id,
            group: self.group,
            auth: self.auth,
            credential_label_hint: None,
            params_schema: serde_json::json!({ "type": "object", "additionalProperties": true }),
            outputs: vec![],
            idempotent: self.idempotent,
        }
    }

    fn execute<'a>(
        &'a self,
        params: &'a Value,
        _ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>> {
        Box::pin(async move {
            self.recorder
                .calls
                .lock()
                .unwrap()
                .push((self.id.to_string(), params.clone()));
            self.gate.pass().await;
            Ok(self.outputs.clone())
        })
    }
}

/// The recording registry plus its inspection handles.
pub struct FakeActions {
    pub registry: Arc<ActionRegistry>,
    pub recorder: ActionRecorder,
    pub gates: HashMap<&'static str, Arc<Gate>>,
}

impl FakeActions {
    pub fn gate(&self, action_id: &str) -> &Arc<Gate> {
        self.gates.get(action_id).expect("gate for action id")
    }
}

fn record(url: &str, title: &str, number: f64, author: &str) -> TokenValue {
    TokenValue::Record(BTreeMap::from([
        ("url".to_string(), TokenValue::Text(url.to_string())),
        ("title".to_string(), TokenValue::Text(title.to_string())),
        ("number".to_string(), TokenValue::Number(number)),
        ("author".to_string(), TokenValue::Text(author.to_string())),
    ]))
}

fn outputs(pairs: &[(&str, TokenValue)]) -> ActionOutputs {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}

/// The catalog the six fixtures reference, with the real idempotency flags and
/// deterministic canned outputs (two PRs so a Repeat iterates twice).
pub fn build_actions() -> FakeActions {
    let recorder = ActionRecorder::default();
    let specs: Vec<(&'static str, ActionGroup, ActionAuth, bool, ActionOutputs)> = vec![
        (
            "notion.add_row",
            ActionGroup::Connector,
            ActionAuth::Token,
            false,
            outputs(&[]),
        ),
        (
            "files.append",
            ActionGroup::Builtin,
            ActionAuth::None,
            false,
            outputs(&[]),
        ),
        (
            "github.list_prs",
            ActionGroup::Connector,
            ActionAuth::Token,
            true,
            outputs(&[(
                "prs",
                TokenValue::List(vec![
                    record("https://github.com/o/r/pull/1", "First", 1.0, "me"),
                    record("https://github.com/o/r/pull/2", "Second", 2.0, "me"),
                ]),
            )]),
        ),
        (
            "github.create_pr",
            ActionGroup::Connector,
            ActionAuth::Token,
            false,
            outputs(&[
                (
                    "prUrl",
                    TokenValue::Text("https://github.com/o/r/pull/9".to_string()),
                ),
                ("prNumber", TokenValue::Number(9.0)),
            ]),
        ),
        (
            "ado.create_item",
            ActionGroup::Connector,
            ActionAuth::Token,
            false,
            outputs(&[
                ("workItemId", TokenValue::Number(42.0)),
                (
                    "url",
                    TokenValue::Text("https://dev.azure.com/o/p/_workitems/edit/42".to_string()),
                ),
            ]),
        ),
        (
            "run_command",
            ActionGroup::Builtin,
            ActionAuth::None,
            false,
            outputs(&[
                ("output", TokenValue::Text("build ok".to_string())),
                ("exitCode", TokenValue::Number(0.0)),
            ]),
        ),
    ];

    let mut registry = ActionRegistry::new();
    let mut gates = HashMap::new();
    for (id, group, auth, idempotent, action_outputs) in specs {
        let gate = Arc::new(Gate::default());
        gates.insert(id, gate.clone());
        registry
            .register(Box::new(RecordingAction {
                id,
                group,
                auth,
                idempotent,
                outputs: action_outputs,
                recorder: recorder.clone(),
                gate,
            }))
            .unwrap();
    }

    FakeActions {
        registry: Arc::new(registry),
        recorder,
        gates,
    }
}
