//! Ported from `packages/types/src/launch.ts`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LaunchProcessStatus {
    Stopped,
    Starting,
    Running,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchConfiguration {
    pub name: String,
    pub runtime_executable: String,
    pub runtime_args: Vec<String>,
    pub port: Option<i64>,
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LaunchConfig {
    pub version: String,
    pub configurations: Vec<LaunchConfiguration>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configuration_serializes_null_port_and_url() {
        let cfg = LaunchConfiguration {
            name: "dev".to_string(),
            runtime_executable: "pnpm".to_string(),
            runtime_args: vec!["dev".to_string()],
            port: None,
            url: None,
            preview: None,
            env: None,
        };
        let json = r#"{"name":"dev","runtimeExecutable":"pnpm","runtimeArgs":["dev"],"port":null,"url":null}"#;
        assert_eq!(serde_json::to_string(&cfg).unwrap(), json);
    }

    #[test]
    fn configuration_round_trips_full() {
        let json = r#"{"name":"web","runtimeExecutable":"node","runtimeArgs":["server.js"],"port":3000,"url":"http://localhost:3000","preview":true}"#;
        let cfg: LaunchConfiguration = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.port, Some(3000));
        assert_eq!(cfg.preview, Some(true));
        assert_eq!(serde_json::to_string(&cfg).unwrap(), json);
    }

    #[test]
    fn process_status_lowercase() {
        assert_eq!(
            serde_json::to_string(&LaunchProcessStatus::Running).unwrap(),
            "\"running\""
        );
    }
}

// PORT STATUS: packages/types/src/launch.ts (17 lines)
// confidence: high
// todos: 0
// notes: `port: number | null` and `url: string | null` are required-nullable →
// Option WITHOUT skip (serialize null). `preview?`/`env?` are optional →
// skip_serializing_if. port → i64 (TCP port). env → HashMap<String,String>.
