//! Ported from `packages/types/src/suggestion.ts`.

use serde::{Deserialize, Serialize};

/// Visual tint for a repo suggestion tile. `accent` = churn/neutral; `amber` = TODO/warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SuggestionTint {
    Accent,
    Amber,
}

/// A single repo-derived starting point shown in the new-session Welcome state.
/// `icon` is a lucide icon name; `prefill` is the composer text inserted on click
/// (never auto-sent). Defined once here and imported by core (endpoint) and ui.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Suggestion {
    pub icon: String,
    pub tint: SuggestionTint,
    pub title: String,
    pub meta: String,
    pub prefill: String,
}

impl Suggestion {
    /// Mirrors the `SuggestionSchema` refinements serde cannot express: the
    /// non-empty (`z.string().min(1)`) constraints on `icon`, `title`, `prefill`.
    /// `meta` is a plain `z.string()` (empty allowed); `tint` is enforced by the
    /// enum during deserialization.
    pub fn validate(&self) -> Result<(), String> {
        if self.icon.is_empty() {
            return Err("icon must contain at least 1 character".to_string());
        }
        if self.title.is_empty() {
            return Err("title must contain at least 1 character".to_string());
        }
        if self.prefill.is_empty() {
            return Err("prefill must contain at least 1 character".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid() -> serde_json::Value {
        json!({
            "icon": "git-compare",
            "tint": "accent",
            "title": "Review the working changes",
            "meta": "git · 3 files",
            "prefill": "Review the uncommitted changes."
        })
    }

    #[test]
    fn accepts_a_well_formed_suggestion() {
        let s: Suggestion = serde_json::from_value(valid()).unwrap();
        assert!(s.validate().is_ok());
        assert_eq!(serde_json::to_value(&s).unwrap(), valid());
    }

    #[test]
    fn rejects_an_unknown_tint() {
        let mut v = valid();
        v["tint"] = json!("green");
        assert!(serde_json::from_value::<Suggestion>(v).is_err());
    }

    #[test]
    fn rejects_a_missing_prefill() {
        let mut v = valid();
        v.as_object_mut().unwrap().remove("prefill");
        assert!(serde_json::from_value::<Suggestion>(v).is_err());
    }

    #[test]
    fn parses_an_array_and_rejects_a_non_array() {
        let list: Vec<Suggestion> = serde_json::from_value(json!([valid(), valid()])).unwrap();
        assert_eq!(list.len(), 2);
        assert!(serde_json::from_value::<Vec<Suggestion>>(valid()).is_err());
    }
}

// PORT STATUS: packages/types/src/suggestion.ts (27 lines)
// confidence: high
// todos: 0
// notes: SuggestionSchema (zod) → serde struct + SuggestionTint enum for shape,
// plus a `validate()` fn for the `.min(1)` refinements. SuggestionListSchema is a
// bare `Vec<Suggestion>`. `validate()` returns `Result<(), String>` (no shared
// ValidationError type — the types crate has neither `thiserror` nor a
// lib.rs-registered validation module; the message is not wire-visible, tests only
// assert pass/fail).
