//! What a paged first window showed, so the full load that follows can tell
//! whether the client already holds the same transcript tail.
use std::hash::{Hash, Hasher};

use mainframe_types::display::DisplayMessage;

/// One window message: its id and a hash of what the client renders of it,
/// load time aside.
pub(crate) type Mark = (String, u64);

pub(crate) fn fingerprint(messages: &[DisplayMessage]) -> Vec<Mark> {
    messages
        .iter()
        .map(|message| {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            // The load time is not content: a Codex history stamps every
            // message with the moment it was converted.
            let mut value = serde_json::to_value(message).unwrap_or_default();
            if let Some(fields) = value.as_object_mut() {
                fields.remove("timestamp");
            }
            value.to_string().hash(&mut hasher);
            (message.id.clone(), hasher.finish())
        })
        .collect()
}

/// Whether `full` ends with exactly the messages the window showed.
pub(crate) fn matches_tail(window: &[Mark], full: &[DisplayMessage]) -> bool {
    if window.is_empty() || full.len() < window.len() {
        tracing::debug!(
            window = window.len(),
            full = full.len(),
            "window longer than history"
        );
        return false;
    }
    let tail = fingerprint(&full[full.len() - window.len()..]);
    let first = tail.iter().zip(window).position(|(a, b)| a != b);
    if let Some(index) = first {
        tracing::debug!(
            index,
            window = window.len(),
            same_id = tail[index].0 == window[index].0,
            "window differs from the loaded history"
        );
    }
    first.is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::display::DisplayMessageType;

    fn message(id: &str, text: &str, timestamp: &str) -> DisplayMessage {
        DisplayMessage {
            id: id.into(),
            chat_id: "c".into(),
            r#type: DisplayMessageType::User,
            content: serde_json::from_value(serde_json::json!([{"type":"text","text":text}]))
                .unwrap(),
            timestamp: timestamp.into(),
            metadata: None,
        }
    }

    #[test]
    fn the_tail_matches_whatever_the_load_time() {
        let window = fingerprint(&[message("b", "two", "t1")]);
        let full = [message("a", "one", "t2"), message("b", "two", "t3")];

        assert!(matches_tail(&window, &full));
    }

    #[test]
    fn changed_text_or_a_longer_window_does_not_match() {
        let window = fingerprint(&[message("b", "two", "t1")]);

        assert!(!matches_tail(&window, &[message("b", "TWO", "t1")]));
        assert!(!matches_tail(
            &fingerprint(&[message("a", "x", "t"), message("b", "two", "t")]),
            &[message("b", "two", "t")]
        ));
        assert!(!matches_tail(&[], &[message("b", "two", "t")]));
    }
}
