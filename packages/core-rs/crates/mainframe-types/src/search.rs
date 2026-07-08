//! Ported from `packages/types/src/search.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchContentResult {
    pub file: String,
    pub line: i64,
    pub column: i64,
    pub text: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let json = r#"{"file":"src/main.rs","line":42,"column":7,"text":"todo"}"#;
        let r: SearchContentResult = serde_json::from_str(json).unwrap();
        assert_eq!(r.line, 42);
        assert_eq!(r.column, 7);
        assert_eq!(serde_json::to_string(&r).unwrap(), json);
    }
}

// PORT STATUS: packages/types/src/search.ts (6 lines)
// confidence: high
// todos: 0
// notes: line/column are 1-based positions → i64 (integer counters).
