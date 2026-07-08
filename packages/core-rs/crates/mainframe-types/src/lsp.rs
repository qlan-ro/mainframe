//! Ported from `packages/types/src/lsp.ts`.

use serde::{Deserialize, Serialize};

/// Configuration for an LSP server binary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LspServerConfig {
    /// Language identifier: 'typescript', 'python', 'java'.
    pub id: String,
    /// File extensions this server handles: ['.ts', '.tsx', '.js', '.jsx'].
    pub languages: Vec<String>,
    /// Server binary command or resolved path.
    pub command: String,
    /// CLI arguments: ['--stdio'].
    pub args: Vec<String>,
    /// Whether the server is bundled with mainframe-core.
    pub bundled: bool,
}

/// Per-language LSP availability status for a project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LspLanguageStatus {
    pub id: String,
    pub installed: bool,
    pub active: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_config_round_trips() {
        let json = r#"{"id":"typescript","languages":[".ts",".tsx"],"command":"typescript-language-server","args":["--stdio"],"bundled":true}"#;
        let c: LspServerConfig = serde_json::from_str(json).unwrap();
        assert_eq!(c.languages.len(), 2);
        assert_eq!(serde_json::to_string(&c).unwrap(), json);
    }

    #[test]
    fn language_status_round_trips() {
        let json = r#"{"id":"python","installed":true,"active":false}"#;
        let s: LspLanguageStatus = serde_json::from_str(json).unwrap();
        assert!(s.installed);
        assert!(!s.active);
        assert_eq!(serde_json::to_string(&s).unwrap(), json);
    }
}

// PORT STATUS: packages/types/src/lsp.ts (21 lines)
// confidence: high
// todos: 0
// notes: plain structs; no optionals, no numeric fields.
