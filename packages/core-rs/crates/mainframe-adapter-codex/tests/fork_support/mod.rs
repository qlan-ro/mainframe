//! Shared support for the Codex fork integration tests (`fork.rs`,
//! `fork_from_message.rs`): a fake `codex app-server` that tees every request
//! to a capture file, and readers for what it captured.
#![allow(dead_code)] // each test binary uses a subset of these helpers

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use mainframe_types::adapter::{ForkSource, SessionOptions, SessionSpawnOptions};
use mainframe_types::chat::MessageContent;
use mainframe_types::content::LeafContent;
use serde_json::Value;

pub fn options(chat_id: Option<&str>, fork_source: Option<ForkSource>) -> SessionOptions {
    SessionOptions {
        // A real, existing directory — `load_history`'s temp-app-server spawn
        // sets this as the child's cwd, which fails outright on a path that
        // doesn't exist (unlike an unresolvable executable, which fails the
        // same way but is the thing each test actually means to control).
        project_path: std::env::temp_dir().to_string_lossy().into_owned(),
        chat_id: chat_id.map(str::to_string),
        mainframe_chat_id: "chat-mf368".to_string(),
        session_file_path: None,
        fork_source,
    }
}

pub fn spawn_options(executable_path: String) -> SessionSpawnOptions {
    SessionSpawnOptions {
        model: Some("gpt-5.5".to_string()),
        permission_mode: None,
        plan_mode: None,
        executable_path: Some(executable_path),
        system_prompt: None,
        tuning: None,
        small_fast_model: None,
        default_model: None,
        no_persistence: None,
    }
}

/// Writes an executable `codex` fake app-server to `dir/codex`, teeing every
/// stdin line to `capture_path` and dispatching `$method_cases` (a raw shell
/// `case` body) by JSON-RPC method. Named literally `codex` so it doubles as
/// both a `SessionSpawnOptions.executable_path` (spawn's explicit override)
/// and, via `ResolvedPath::from_value(dir)`, the `"codex"` PATH lookup
/// `load_history`'s and `pin_fork_point`'s hardcoded temp-app-server spawns
/// use — neither takes an executable override.
pub fn write_fake_app_server(
    dir: &Path,
    capture_path: &Path,
    method_cases: &str,
) -> std::path::PathBuf {
    let script = format!(
        r#"#!/bin/sh
while IFS= read -r line; do
  printf '%s\n' "$line" >> '{capture}'
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$method" in
    initialize)
      printf '{{"id":%s,"result":{{"userAgent":"codex/0.155.1","codexHome":"/tmp/.codex"}}}}\n' "$id"
      ;;
    initialized) ;;
{cases}
  esac
done
"#,
        capture = capture_path.display(),
        cases = method_cases,
    );
    let fake = dir.join("codex");
    fs::write(&fake, script).unwrap();
    let mut perms = fs::metadata(&fake).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&fake, perms).unwrap();
    fake
}

pub fn captured_requests(capture_path: &Path) -> Vec<Value> {
    let text = fs::read_to_string(capture_path).unwrap_or_default();
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("captured line is valid JSON"))
        .collect()
}

pub fn requests_with_method<'a>(reqs: &'a [Value], method: &str) -> Vec<&'a Value> {
    reqs.iter().filter(|v| v["method"] == method).collect()
}

pub fn message_texts(messages: &[mainframe_types::chat::ChatMessage]) -> Vec<String> {
    messages
        .iter()
        .flat_map(|m| m.content.iter())
        .filter_map(|c| match c {
            MessageContent::Leaf(LeafContent::Text { text, .. }) => Some(text.clone()),
            _ => None,
        })
        .collect()
}
