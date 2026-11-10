use mainframe_adapter_api::idle_compaction::CacheClassification;
use serde_json::Value;

#[derive(Default)]
pub(crate) struct CacheEvidence {
    pub classification: CacheClassification,
    decisive: bool,
    identity: CacheIdentity,
}
#[derive(Default, PartialEq, Clone)]
struct CacheIdentity {
    source: Option<String>,
    account: Option<Value>,
    routed: bool,
}
impl CacheEvidence {
    pub fn observe(&mut self, event: &Value, routed: bool) {
        let account = event
            .get("account")
            .or_else(|| event.pointer("/response/response/account"));
        let source = event.get("apiKeySource").and_then(Value::as_str);
        let mut identity = self.identity.clone();
        identity.routed = routed;
        if let Some(source) = source {
            identity.source = Some(source.to_owned());
        }
        if let Some(account) = account.filter(|a| a.is_object()) {
            identity.account = Some(account.clone());
        }
        if identity != self.identity {
            self.decisive = false;
            self.classification = CacheClassification::Unknown;
            self.identity = identity;
        }
        if !self.decisive {
            self.classification = init_classification(&self.identity);
        }
        let (hour, short) = usage_evidence(event);
        if hour || short {
            self.decisive = true;
            self.classification = if short {
                CacheClassification::Claude5m
            } else {
                CacheClassification::Claude1h
            };
        }
    }
}
fn init_classification(identity: &CacheIdentity) -> CacheClassification {
    use CacheClassification::*;
    if identity.routed {
        return Unknown;
    }
    let account_source = identity
        .account
        .as_ref()
        .and_then(|a| a.get("apiKeySource"))
        .and_then(Value::as_str);
    let sources = [identity.source.as_deref(), account_source];
    if sources.iter().any(|source| {
        matches!(
            source,
            Some("user" | "project" | "org" | "environment" | "api_key" | "ANTHROPIC_API_KEY")
        )
    }) {
        return Claude5m;
    }
    let subscription = identity
        .account
        .as_ref()
        .and_then(|a| a.get("subscriptionType"))
        .and_then(Value::as_str);
    if sources
        .iter()
        .all(|source| source.is_none_or(|s| matches!(s, "none" | "oauth" | "claude.ai")))
        && matches!(subscription, Some("pro" | "max" | "team" | "enterprise"))
    {
        return Claude1h;
    }
    Unknown
}
fn usage_evidence(event: &Value) -> (bool, bool) {
    let usage = match event.get("type").and_then(Value::as_str) {
        Some("assistant") => event.pointer("/message/usage"),
        Some("result") => event.get("usage"),
        Some("stream_event") => match event.pointer("/event/type").and_then(Value::as_str) {
            Some("message_start") => event.pointer("/event/message/usage"),
            Some("message_delta") => event.pointer("/event/usage"),
            _ => None,
        },
        _ => None,
    };
    let mut evidence = counters(usage);
    if event.get("type").and_then(Value::as_str) == Some("result")
        && let Some(models) = event.get("modelUsage").and_then(Value::as_object)
    {
        for usage in models.values() {
            let next = counters(Some(usage));
            evidence.0 |= next.0;
            evidence.1 |= next.1;
        }
    }
    evidence
}
fn counters(usage: Option<&Value>) -> (bool, bool) {
    let cache = usage.and_then(|u| u.get("cache_creation"));
    let positive = |key| {
        cache
            .and_then(|c| c.get(key))
            .and_then(Value::as_u64)
            .is_some_and(|n| n > 0)
    };
    (
        positive("ephemeral_1h_input_tokens"),
        positive("ephemeral_5m_input_tokens"),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn usage_wins_and_zero_retains_until_account_changes() {
        let mut c = CacheEvidence::default();
        c.observe(
            &json!({"subtype":"init","account":{"subscriptionType":"max"}}),
            false,
        );
        assert_eq!(c.classification, CacheClassification::Claude1h);
        c.observe(
            &json!({"type":"assistant","message":{"usage":{"cache_creation":{"ephemeral_5m_input_tokens":1}}}}),
            false,
        );
        assert_eq!(c.classification, CacheClassification::Claude5m);
        c.observe(
            &json!({"type":"result","usage":{"cache_creation":{"ephemeral_1h_input_tokens":0}}}),
            false,
        );
        assert_eq!(c.classification, CacheClassification::Claude5m);
        c.observe(
            &json!({"subtype":"init","account":{"subscriptionType":"pro"}}),
            true,
        );
        assert_eq!(c.classification, CacheClassification::Unknown);
        c.observe(
            &json!({"type":"result","usage":{"cache_creation":{"ephemeral_1h_input_tokens":2}}}),
            true,
        );
        assert_eq!(c.classification, CacheClassification::Claude1h);
    }
    #[test]
    fn mixed_and_api_key_conflict_are_conservative() {
        let mut c = CacheEvidence::default();
        c.observe(
            &json!({"subtype":"init","apiKeySource":"user","account":{"subscriptionType":"max"}}),
            false,
        );
        assert_eq!(c.classification, CacheClassification::Claude5m);
        c.observe(&json!({"type":"result","usage":{"cache_creation":{"ephemeral_1h_input_tokens":2,"ephemeral_5m_input_tokens":1}}}),false);
        assert_eq!(c.classification, CacheClassification::Claude5m);
    }
}

#[cfg(test)]
mod fallback_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn unknown_sources_do_not_infer_subscription_and_missing_usage_retains_policy() {
        let mut c = CacheEvidence::default();
        c.observe(&json!({"subtype":"init","apiKeySource":"unrecognized","account":{"subscriptionType":"max"}}),false);
        assert_eq!(c.classification, CacheClassification::Unknown);
        c.observe(
            &json!({"type":"result","usage":{"cache_creation":{"ephemeral_1h_input_tokens":1}}}),
            false,
        );
        c.observe(&json!({"type":"result","usage":{"cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0}}}),false);
        c.observe(
            &json!({"type":"result","usage":{"input_tokens":0,"cache_read_input_tokens":100}}),
            false,
        );
        assert_eq!(c.classification, CacheClassification::Claude1h);
        c.observe(&json!({"subtype":"init","apiKeySource":"unrecognized","account":{"subscriptionType":"max"}}),false);
        assert_eq!(c.classification, CacheClassification::Claude1h);
        c.observe(&json!({"subtype":"init","apiKeySource":"unrecognized","account":{"subscriptionType":"max"}}),true);
        assert_eq!(c.classification, CacheClassification::Unknown);
    }
}

#[cfg(test)]
mod account_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn nested_account_response_combines_with_init_without_erasing_key_evidence() {
        let mut c = CacheEvidence::default();
        c.observe(
            &json!({"type":"system","subtype":"init","apiKeySource":"user"}),
            false,
        );
        c.observe(&json!({"type":"control_response","response":{"response":{"account":{"subscriptionType":"max","apiKeySource":"none"}}}}),false);
        assert_eq!(c.classification, CacheClassification::Claude5m);
        let mut c = CacheEvidence::default();
        c.observe(&json!({"response":{"response":{"account":{"subscriptionType":"max","apiKeySource":"none"}}}}),false);
        assert_eq!(c.classification, CacheClassification::Claude1h);
        c.observe(&json!({"subtype":"init","apiKeySource":"none"}), false);
        assert_eq!(c.classification, CacheClassification::Claude1h);
    }
}

#[cfg(test)]
mod envelope_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_recognized_usage_envelopes_classify_cache() {
        let usage = json!({"cache_creation":{"ephemeral_1h_input_tokens":1}});
        let invalid = [
            json!({"type":"assistant","message":{"content":[{"type":"tool_use","input":usage}]}}),
            json!({"type":"user","message":{"content":[{"type":"tool_result","content":usage}]}}),
            json!({"type":"control_response","response":{"usage":usage}}),
            json!({"type":"system","usage":usage}),
            json!({"type":"result","content":usage}),
        ];
        for event in invalid {
            for routed in [false, true] {
                let mut c = CacheEvidence::default();
                c.observe(
                    &json!({"type":"system","subtype":"init","apiKeySource":"user"}),
                    routed,
                );
                let before = c.classification;
                c.observe(&event, routed);
                c.observe(
                    &json!({"type":"result","usage":{"input_tokens":10}}),
                    routed,
                );
                assert_eq!(c.classification, before, "{event}");
            }
        }
        let valid = [
            json!({"type":"assistant","message":{"usage":usage}}),
            json!({"type":"result","usage":usage}),
            json!({"type":"result","modelUsage":{"model":usage}}),
            json!({"type":"stream_event","event":{"type":"message_start","message":{"usage":usage}}}),
            json!({"type":"stream_event","event":{"type":"message_delta","usage":usage}}),
        ];
        for event in valid {
            let mut c = CacheEvidence::default();
            c.observe(&event, true);
            assert_eq!(c.classification, CacheClassification::Claude1h, "{event}");
        }
    }
}
