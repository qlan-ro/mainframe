//! Translated from `packages/core/src/__tests__/lsp/lsp-registry.test.ts`, plus
//! new bring-your-own discovery-order cases (no TS twin — the Node daemon
//! resolved bundled servers via `require.resolve`, which has no Rust analogue).

use super::*;
use std::os::unix::fs::PermissionsExt;

fn registry() -> LspRegistry {
    LspRegistry::new()
}

/// Creates an empty executable file at `dir/segments...`, making parent dirs.
fn touch_executable(dir: &std::path::Path, segments: &[&str]) -> std::path::PathBuf {
    let mut path = dir.to_path_buf();
    for seg in segments {
        path.push(seg);
    }
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"#!/bin/sh\n").unwrap();
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).unwrap();
    path
}

#[test]
fn returns_config_for_typescript() {
    let config = registry().get_config("typescript").cloned().unwrap();
    assert_eq!(config.id, "typescript");
    assert!(config.languages.contains(&".ts".to_string()));
    assert!(config.languages.contains(&".tsx".to_string()));
    assert!(config.languages.contains(&".js".to_string()));
    assert!(config.languages.contains(&".jsx".to_string()));
    assert!(config.bundled);
}

#[test]
fn returns_config_for_python() {
    let config = registry().get_config("python").cloned().unwrap();
    assert_eq!(config.id, "python");
    assert!(config.languages.contains(&".py".to_string()));
    assert!(config.bundled);
}

#[test]
fn returns_config_for_java() {
    let config = registry().get_config("java").cloned().unwrap();
    assert_eq!(config.id, "java");
    assert!(config.languages.contains(&".java".to_string()));
    assert!(!config.bundled);
}

#[test]
fn returns_none_for_unknown_language() {
    assert!(registry().get_config("rust").is_none());
}

#[test]
fn resolves_language_from_file_extension() {
    let r = registry();
    assert_eq!(
        r.get_language_for_extension(".ts").as_deref(),
        Some("typescript")
    );
    assert_eq!(
        r.get_language_for_extension(".tsx").as_deref(),
        Some("typescript")
    );
    assert_eq!(
        r.get_language_for_extension(".py").as_deref(),
        Some("python")
    );
    assert_eq!(
        r.get_language_for_extension(".java").as_deref(),
        Some("java")
    );
    assert_eq!(r.get_language_for_extension(".rs"), None);
}

#[test]
fn lists_all_registered_language_ids() {
    assert_eq!(
        registry().get_all_language_ids(),
        vec!["typescript", "python", "java"]
    );
}

#[tokio::test]
async fn project_local_node_modules_bin_wins_over_path() {
    let project = tempfile::tempdir().unwrap();
    let local = touch_executable(
        project.path(),
        &["node_modules", ".bin", "typescript-language-server"],
    );

    // An empty PATH means the `command -v` probe would find nothing, so a
    // successful resolution here proves the project-local lookup ran (and,
    // combined with the next test, that it is tried first).
    let r = LspRegistry::new().with_resolved_path("");
    let result = r
        .resolve_command("typescript", project.path().to_str().unwrap())
        .await
        .unwrap();
    assert_eq!(result.command, local.to_string_lossy());
    assert_eq!(result.args, vec!["--stdio".to_string()]);
}

#[tokio::test]
async fn pyright_resolves_from_project_venv() {
    let project = tempfile::tempdir().unwrap();
    let venv_bin = touch_executable(project.path(), &[".venv", "bin", "pyright-langserver"]);

    let r = LspRegistry::new().with_resolved_path("");
    let result = r
        .resolve_command("python", project.path().to_str().unwrap())
        .await
        .unwrap();
    assert_eq!(result.command, venv_bin.to_string_lossy());
}

// `$VIRTUAL_ENV` resolution is exercised against the private `venv_bin` helper
// directly, with the override passed as a plain argument, rather than through
// the public `resolve_command` + `std::env::set_var`: this crate is
// `#![forbid(unsafe_code)]` (edition 2024 makes `set_var` unsafe) and the
// codebase's convention is to thread captured env explicitly instead of
// mutating the process env from tests (see `mainframe-runtime::ResolvedPath`).
#[tokio::test]
async fn venv_bin_resolves_from_virtual_env_override_when_project_venv_absent() {
    let venv = tempfile::tempdir().unwrap();
    let expected = touch_executable(venv.path(), &["bin", "pyright-langserver"]);
    let project = tempfile::tempdir().unwrap();

    let result = venv_bin(
        project.path().to_str().unwrap(),
        Some(venv.path().to_str().unwrap()),
        "pyright-langserver",
    )
    .await;
    assert_eq!(result, Some(expected.to_string_lossy().into_owned()));
}

#[tokio::test]
async fn venv_bin_prefers_project_venv_over_virtual_env_override() {
    let project = tempfile::tempdir().unwrap();
    let project_venv_bin =
        touch_executable(project.path(), &[".venv", "bin", "pyright-langserver"]);
    let other_venv = tempfile::tempdir().unwrap();
    touch_executable(other_venv.path(), &["bin", "pyright-langserver"]);

    let result = venv_bin(
        project.path().to_str().unwrap(),
        Some(other_venv.path().to_str().unwrap()),
        "pyright-langserver",
    )
    .await;
    assert_eq!(
        result,
        Some(project_venv_bin.to_string_lossy().into_owned())
    );
}

#[tokio::test]
async fn falls_back_to_command_v_on_the_resolved_path() {
    let project = tempfile::tempdir().unwrap();
    let path_dir = tempfile::tempdir().unwrap();
    touch_executable(path_dir.path(), &["jdtls"]);

    // No node_modules/.bin, no venv for `java` — `jdtls` only resolves via the
    // `command -v` probe against the injected PATH.
    let r = LspRegistry::new().with_resolved_path(path_dir.path().to_str().unwrap());
    let result = r
        .resolve_command("java", project.path().to_str().unwrap())
        .await
        .unwrap();
    assert_eq!(result.command, "jdtls");
    assert!(result.args.is_empty());
}

#[tokio::test]
async fn returns_none_cleanly_when_nothing_resolves() {
    let project = tempfile::tempdir().unwrap();
    let r = LspRegistry::new().with_resolved_path("");
    let result = r
        .resolve_command("typescript", project.path().to_str().unwrap())
        .await;
    assert!(result.is_none());
}

#[tokio::test]
async fn returns_none_for_unknown_language_resolution() {
    let project = tempfile::tempdir().unwrap();
    assert!(
        registry()
            .resolve_command("rust", project.path().to_str().unwrap())
            .await
            .is_none()
    );
}
