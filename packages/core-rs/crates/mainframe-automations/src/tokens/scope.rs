//! Token scope with parent-chain Repeat isolation (plan T3.1): a Repeat
//! iteration is a child scope carrying its own `current` item; bindings made
//! inside it die with it, while everything above stays visible.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{SecondsFormat, Utc};

use crate::domain::{TOKEN_STEP_BUILTIN, TOKEN_STEP_CURRENT, TokenRef};
use crate::ports::Clock;

use super::value::TokenValue;

pub struct Scope<'a> {
    parent: Option<&'a Scope<'a>>,
    clock: Option<Arc<dyn Clock>>,
    bindings: HashMap<(String, String), TokenValue>,
    current_item: Option<TokenValue>,
}

impl Scope<'_> {
    pub fn root(clock: Arc<dyn Clock>) -> Scope<'static> {
        Scope {
            parent: None,
            clock: Some(clock),
            bindings: HashMap::new(),
            current_item: None,
        }
    }

    /// Binds a named output into THIS scope level — the interpreter binds
    /// trigger tokens and step outputs where they were produced.
    pub fn bind(&mut self, step_id: &str, output: &str, value: TokenValue) {
        self.bindings
            .insert((step_id.to_string(), output.to_string()), value);
    }

    /// Sets `current` on THIS scope level — the interpreter builds one flat
    /// scope per walk frame (Node `buildTokenContext`) and stamps the
    /// innermost Repeat item on it.
    pub fn set_current(&mut self, item: TokenValue) {
        self.current_item = Some(item);
    }

    /// A Repeat iteration: sees everything above, owns `current`, and drops
    /// its own bindings when the iteration ends.
    pub fn child_iteration(&self, item: TokenValue) -> Scope<'_> {
        Scope {
            parent: Some(self),
            clock: None,
            bindings: HashMap::new(),
            current_item: Some(item),
        }
    }

    /// Resolves a token to its raw typed value; `None` means unset (renders
    /// as '' and compares as false — never an error).
    pub fn resolve(&self, token: &TokenRef) -> Option<TokenValue> {
        let base = match token.step_id.as_str() {
            TOKEN_STEP_BUILTIN => self.builtin(&token.output),
            TOKEN_STEP_CURRENT => self.current(),
            _ => self.lookup(&token.step_id, &token.output),
        }?;
        match &token.field {
            Some(field) => dig(&base, field),
            None => Some(base),
        }
    }

    fn lookup(&self, step_id: &str, output: &str) -> Option<TokenValue> {
        let key = (step_id.to_string(), output.to_string());
        match self.bindings.get(&key) {
            Some(value) => Some(value.clone()),
            None => self.parent.and_then(|p| p.lookup(step_id, output)),
        }
    }

    fn current(&self) -> Option<TokenValue> {
        match &self.current_item {
            Some(item) => Some(item.clone()),
            None => self.parent.and_then(|p| p.current()),
        }
    }

    fn builtin(&self, output: &str) -> Option<TokenValue> {
        let now = self.clock_now()?;
        match output {
            // Local calendar date.
            "today" => Some(TokenValue::Text(now.format("%Y-%m-%d").to_string())),
            // UTC instant, Node `toISOString()` form (millis + literal Z).
            "now" => Some(TokenValue::Text(
                now.with_timezone(&Utc)
                    .to_rfc3339_opts(SecondsFormat::Millis, true),
            )),
            _ => None,
        }
    }

    fn clock_now(&self) -> Option<chrono::DateTime<chrono::FixedOffset>> {
        match &self.clock {
            Some(clock) => Some(clock.now()),
            None => self.parent.and_then(|p| p.clock_now()),
        }
    }
}

/// Dot-path descent (Node `digField`): records by key, lists by integer
/// index; any miss along the way resolves to `None`, never an error.
fn dig(value: &TokenValue, field: &str) -> Option<TokenValue> {
    let mut cursor = value.clone();
    for key in field.split('.') {
        cursor = match cursor {
            TokenValue::Record(entries) => entries.get(key)?.clone(),
            TokenValue::List(items) => items.get(key.parse::<usize>().ok()?)?.clone(),
            _ => return None,
        };
    }
    Some(cursor)
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T3.1), not a TS port
// confidence: high
// todos: 0
// notes: `current` ignores TokenRef.output (Node parity — the editor writes
//        output:"item" but resolution keys on the reserved stepId alone).
