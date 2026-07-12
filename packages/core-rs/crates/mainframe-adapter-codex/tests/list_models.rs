//! Ported from `packages/core/src/plugins/builtin/codex/__tests__/list-models.test.ts`.
//!
//! The `mapCodexModel` mapping assertions live inline in `src/adapter.rs`; this file
//! ports the `probes models with the configured executable path` case. The vitest
//! version mocks `node:child_process`; the Rust port drives a real `codex app-server`
//! handshake against a fake newline-JSON-RPC executable at the configured path, which
//! proves both the mapping/hidden-filter and that the configured binary is spawned.
#![cfg(unix)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::fs;
use std::os::unix::fs::PermissionsExt;

use mainframe_adapter_api::Adapter;
use mainframe_adapter_codex::CodexAdapter;
use tempfile::tempdir;

/// A fake `codex` that answers `initialize` (id 1) then `model/list` (id 2) over
/// newline-delimited JSON-RPC, mirroring the app-server handshake.
const FAKE_APP_SERVER: &str = r#"#!/bin/sh
IFS= read -r _initialize
printf '{"id":1,"result":{"userAgent":"codex/0.144.1","codexHome":"/tmp/.codex"}}\n'
IFS= read -r _initialized
IFS= read -r _model_list
printf '{"id":2,"result":{"data":[{"id":"gpt-5.6-sol","displayName":"GPT-5.6-Sol","hidden":false,"isDefault":true},{"id":"hidden-model","displayName":"Hidden","hidden":true,"isDefault":false}],"nextCursor":null}}\n'
cat >/dev/null
"#;

#[tokio::test]
async fn probes_models_with_the_configured_executable_path() {
    let dir = tempdir().unwrap();
    let fake = dir.path().join("codex");
    fs::write(&fake, FAKE_APP_SERVER).unwrap();
    let mut perms = fs::metadata(&fake).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&fake, perms).unwrap();

    let adapter = CodexAdapter::default();
    assert!(adapter.has_probe_models());
    let models = adapter
        .probe_models(Some(fake.to_str().unwrap().to_string()))
        .await
        .unwrap()
        .expect("probe returns a catalog");

    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "gpt-5.6-sol");
    assert_eq!(models[0].label, "GPT-5.6-Sol");
    assert_eq!(models[0].is_default, Some(true));
}
