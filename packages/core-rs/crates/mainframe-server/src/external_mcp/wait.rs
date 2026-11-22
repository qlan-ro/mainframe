//! `chat_wait`: block until a chat is idle, needs an answer, or has ended, so
//! a client that cannot be polled by hand learns when to speak up.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use mainframe_orchestration::{
    errors::{ErrorCode, ToolError, cap_chars},
    last_assistant_text,
    policy::{
        DEFAULT_WAIT_MS, LAST_TEXT_CAP, MAX_CONCURRENT_WAITS, MAX_SINGLE_WAIT_MS, MAX_WAIT_MS,
        MIN_WAIT_MS,
    },
    ports::{ChatView, OrchestrationPort},
    state::{ChatState, derive_state},
    waiter::{WaitEnd, wait_on},
};
use mainframe_types::{external_mcp::ExternalMcpClient, sync::LockExt as _};
use serde_json::{Value, json};

use super::{input::WaitInput, prompt, reads};
use crate::ctx::AppCtx;

pub async fn wait(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    input: WaitInput,
) -> Result<Value, ToolError> {
    let requested = input.timeout_ms.unwrap_or(DEFAULT_WAIT_MS);
    if !(MIN_WAIT_MS..=MAX_WAIT_MS).contains(&requested) {
        return Err(ToolError::invalid(format!(
            "timeoutMs must be {MIN_WAIT_MS} to {MAX_WAIT_MS}"
        )));
    }
    let _slot = WaitSlot::claim(&client.id).ok_or_else(|| {
        ToolError::new(
            ErrorCode::RateLimited,
            "Too many concurrent waits for this client.",
        )
    })?;
    let requested = Duration::from_millis(requested);
    let capped = requested.min(Duration::from_millis(MAX_SINGLE_WAIT_MS));
    let rx = reads::port(ctx).subscribe();
    let watched = [input.chat_id.clone()];
    // Scope is re-read on every probe: a chat that leaves the client's reach
    // mid-wait ends the wait with that refusal instead of being reported on.
    let probe = || async {
        match reads::target(ctx, client, &input.chat_id).await {
            Ok(chat) => settled(&chat).then_some(Ok(chat)),
            Err(refused) => Some(Err(refused)),
        }
    };
    match wait_on(rx, capped, &watched, probe).await {
        WaitEnd::Matched(chat) => Ok(result(ctx, client, &chat?, 0).await),
        WaitEnd::TimedOut => {
            let chat = reads::target(ctx, client, &input.chat_id).await?;
            let remaining = requested.saturating_sub(capped).as_millis() as u64;
            Ok(result(ctx, client, &chat, remaining).await)
        }
        WaitEnd::Cancelled => Err(ToolError::new(
            ErrorCode::OrchestrationError,
            "Mainframe is shutting down; try again shortly",
        )),
    }
}

/// Anything but a running turn: the chat is idle, wants an answer, or ended.
fn settled(chat: &ChatView) -> bool {
    derive_state(chat, false) != ChatState::Working
}

/// `remaining_ms` is what is left of the caller's own budget after this call
/// hit the per-call cap; zero means the budget is spent.
async fn result(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    chat: &ChatView,
    remaining_ms: u64,
) -> Value {
    let matched = settled(chat);
    let still_waiting = !matched && remaining_ms > 0;
    let text = last_assistant_text(&ctx.chat.chat_manager.get_messages(&chat.id).await);
    let prompt = match ctx.chat.chat_manager.get_pending_permission(&chat.id).await {
        Some(request) => prompt::view(client, chat, &request),
        None => Value::Null,
    };
    json!({
        "chat": reads::summary(chat),
        "stillWaiting": still_waiting,
        "waitTimedOut": !matched && !still_waiting,
        "remainingMs": if still_waiting { json!(remaining_ms) } else { Value::Null },
        "lastAssistantText": if text.is_empty() { Value::Null } else { json!(cap_chars(&text, LAST_TEXT_CAP)) },
        "pendingPrompt": prompt,
    })
}

fn waits() -> &'static Mutex<HashMap<String, usize>> {
    static WAITS: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();
    WAITS.get_or_init(Mutex::default)
}

/// One of a client's blocking-call slots; frees on drop, including when the
/// HTTP caller disconnects and the request future is dropped mid-wait.
struct WaitSlot(String);

impl WaitSlot {
    fn claim(client_id: &str) -> Option<Self> {
        let mut waits = waits().lock_recover();
        let count = waits.entry(client_id.to_owned()).or_insert(0);
        if *count >= MAX_CONCURRENT_WAITS {
            return None;
        }
        *count += 1;
        Some(Self(client_id.to_owned()))
    }
}

impl Drop for WaitSlot {
    fn drop(&mut self) {
        let mut waits = waits().lock_recover();
        if let Some(count) = waits.get_mut(&self.0) {
            *count -= 1;
            if *count == 0 {
                waits.remove(&self.0);
            }
        }
    }
}

/// How many waits `client_id` holds right now.
#[cfg(test)]
pub(super) fn held(client_id: &str) -> usize {
    waits().lock_recover().get(client_id).copied().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_client_holds_a_bounded_number_of_waits_and_a_finished_one_frees_its_slot() {
        let held: Vec<_> = (0..MAX_CONCURRENT_WAITS)
            .map(|_| WaitSlot::claim("slot-test-client").unwrap())
            .collect();
        assert!(WaitSlot::claim("slot-test-client").is_none());
        assert!(WaitSlot::claim("another-client").is_some());
        drop(held);
        assert!(WaitSlot::claim("slot-test-client").is_some());
    }
}
