use super::*;
use std::os::unix::fs::PermissionsExt;

/// Creates an empty executable file at `dir/relative`, making parent dirs.
fn touch_executable(dir: &Path, relative: &str) -> PathBuf {
    let path = dir.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"#!/bin/sh\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

/// A registry whose `PATH` is `dir` (or empty), so lookups never reach the
/// machine's real toolchain.
fn registry(path: Option<&Path>) -> LspRegistry {
    let value = path
        .map(|p| p.to_str().unwrap().to_owned())
        .unwrap_or_default();
    LspRegistry::new().with_resolved_path(ResolvedPath::from_value(value))
}

#[test]
fn supports_the_listed_languages_in_order() {
    let registry = LspRegistry::new();
    assert_eq!(
        registry.language_ids().collect::<Vec<_>>(),
        ["typescript", "python", "java"]
    );
    assert!(registry.supports("python"));
    assert!(!registry.supports("rust"));
}

#[tokio::test]
async fn project_node_modules_bin_wins_over_path() {
    let project = tempfile::tempdir().unwrap();
    let local = touch_executable(
        project.path(),
        "node_modules/.bin/typescript-language-server",
    );
    let path_dir = tempfile::tempdir().unwrap();
    touch_executable(path_dir.path(), "typescript-language-server");

    let resolved = registry(Some(path_dir.path()))
        .resolve_command("typescript", Some(project.path()))
        .await
        .unwrap();
    assert_eq!(
        resolved,
        ResolvedCommand {
            command: local,
            args: vec!["--stdio".to_owned()]
        }
    );
}

#[tokio::test]
async fn pyright_resolves_from_the_project_venv() {
    let project = tempfile::tempdir().unwrap();
    let venv_bin = touch_executable(project.path(), ".venv/bin/pyright-langserver");
    let resolved = registry(None)
        .resolve_command("python", Some(project.path()))
        .await
        .unwrap();
    assert_eq!(resolved.command, venv_bin);
}

#[tokio::test]
async fn virtual_env_resolves_when_the_project_has_no_venv() {
    let venv = tempfile::tempdir().unwrap();
    let expected = touch_executable(venv.path(), "bin/pyright-langserver");
    let project = tempfile::tempdir().unwrap();
    assert_eq!(
        project_bin(
            Some(project.path()),
            Some(venv.path()),
            "pyright-langserver"
        )
        .await,
        Some(expected.clone())
    );
    assert_eq!(
        project_bin(None, Some(venv.path()), "pyright-langserver").await,
        Some(expected)
    );
}

#[tokio::test]
async fn project_venv_wins_over_virtual_env() {
    let project = tempfile::tempdir().unwrap();
    let project_venv = touch_executable(project.path(), ".venv/bin/pyright-langserver");
    let other = tempfile::tempdir().unwrap();
    touch_executable(other.path(), "bin/pyright-langserver");
    assert_eq!(
        project_bin(
            Some(project.path()),
            Some(other.path()),
            "pyright-langserver"
        )
        .await,
        Some(project_venv)
    );
}

#[tokio::test]
async fn falls_back_to_the_resolved_path() {
    let project = tempfile::tempdir().unwrap();
    let path_dir = tempfile::tempdir().unwrap();
    let jdtls = touch_executable(path_dir.path(), "jdtls");
    let registry = registry(Some(path_dir.path()));

    let resolved = registry
        .resolve_command("java", Some(project.path()))
        .await
        .unwrap();
    assert_eq!(
        resolved,
        ResolvedCommand {
            command: jdtls,
            args: vec![]
        }
    );
    assert!(registry.is_installed("java").await);
}

#[tokio::test]
async fn a_non_executable_file_does_not_resolve() {
    let project = tempfile::tempdir().unwrap();
    let path = project
        .path()
        .join("node_modules/.bin/typescript-language-server");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"").unwrap();
    assert!(
        registry(None)
            .resolve_command("typescript", Some(project.path()))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn nothing_resolves_for_a_missing_server_or_an_unknown_language() {
    let project = tempfile::tempdir().unwrap();
    let registry = registry(None);
    assert!(
        registry
            .resolve_command("typescript", Some(project.path()))
            .await
            .is_none()
    );
    assert!(
        registry
            .resolve_command("rust", Some(project.path()))
            .await
            .is_none()
    );
    assert!(!registry.is_installed("typescript").await);
}
