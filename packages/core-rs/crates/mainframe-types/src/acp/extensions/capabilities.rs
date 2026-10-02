use serde::{Deserialize, Serialize};

/// Mainframe's agent-capabilities extension, advertised in `initialize`'s
/// response under `_meta["_mainframe.dev"]`. Generic ACP clients see none of
/// these keys and degrade gracefully (spec: "option-only gates, no
/// queued-turn metadata").
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainframeCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_permission_answers: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queued_prompts: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_markers: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heartbeat_interval_ms: Option<i64>,
    /// Whether `create_update` stamps [`super::ITEM_CREATED_META_KEY`] on an item's
    /// complete first frame (spec Decision 37) — a client gates its strict
    /// accumulator mode on this rather than assuming it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_creation_markers: Option<bool>,
    /// Whether every successful `session/resume` reply is followed by
    /// exactly one `_mainframe.dev/replay_complete` for that session (spec
    /// Decision 38) — a client stages a full replay off-screen only when
    /// this is advertised.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replay_complete: Option<bool>,
    /// When true, item streaming markers describe top-level text/thinking overlays; an absent/false marker means no overlay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authoritative_item_streaming: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn capabilities_omit_all_absent_fields() {
        let caps = MainframeCapabilities {
            rich_permission_answers: None,
            queued_prompts: None,
            retry_markers: None,
            heartbeat_interval_ms: None,
            item_creation_markers: None,
            replay_complete: None,
            authoritative_item_streaming: None,
        };
        assert_eq!(serde_json::to_value(caps).unwrap(), json!({}));
    }

    #[test]
    fn authoritative_streaming_is_optional_and_preserves_explicit_booleans() {
        let absent: MainframeCapabilities = serde_json::from_value(json!({})).unwrap();
        assert_eq!(absent.authoritative_item_streaming, None);
        for value in [true, false] {
            let wire = json!({ "authoritativeItemStreaming": value });
            let caps: MainframeCapabilities = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(caps.authoritative_item_streaming, Some(value));
            assert_eq!(serde_json::to_value(caps).unwrap(), wire);
        }
    }
}
