//! `turn/steer`: folds a message into Codex's running turn. The shape
//! (`threadId`, `expectedTurnId`, `input`) follows t3code's Codex adapter and
//! is pending live verification (spec Gate 0). `expectedTurnId` makes the
//! app-server reject a steer that raced the turn's end instead of starting a
//! new turn with it.

use mainframe_types::sync::LockExt as _;
use serde_json::{Value, json};

use super::*;

/// The `turn/steer` params for one text message.
pub(crate) fn steer_params(
    thread_id: &str,
    turn_id: &str,
    message: &str,
) -> Result<Value, AdapterError> {
    let crate::user_input::TurnInput { input, .. } =
        crate::user_input::build_turn_input(message, &[]);
    let input = serde_json::to_value(&input).map_err(|e| AdapterError::Message(e.to_string()))?;
    Ok(json!({ "threadId": thread_id, "expectedTurnId": turn_id, "input": input }))
}

impl CodexSession {
    pub(super) async fn steer_inner(&self, message: String) -> Result<(), AdapterError> {
        let client = self.client.lock_recover().clone();
        let (thread_id, turn_id) = {
            let st = self.state.lock_recover();
            (st.thread_id.clone(), st.current_turn_id.clone())
        };
        let (Some(client), Some(thread_id), Some(turn_id)) = (client, thread_id, turn_id) else {
            return Err(AdapterError::Message(format!(
                "Session {} has no active turn to steer",
                self.id
            )));
        };
        let params = steer_params(&thread_id, &turn_id, &message)?;
        client
            .request("turn/steer", Some(params))
            .await
            .map_err(|e| AdapterError::Message(e.0))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steer_params_name_the_turn_they_expect() {
        let params = steer_params("th1", "tu1", "also check the tests").unwrap();
        assert_eq!(params["threadId"], "th1");
        assert_eq!(params["expectedTurnId"], "tu1");
        assert_eq!(params["input"][0]["type"], "text");
        assert_eq!(params["input"][0]["text"], "also check the tests");
    }
}
