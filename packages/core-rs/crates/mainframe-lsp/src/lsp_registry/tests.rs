//! Translated from `packages/core/src/__tests__/lsp/lsp-registry.test.ts`.

use super::*;

fn registry() -> LspRegistry {
    LspRegistry::new()
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
async fn resolves_bundled_typescript_server_via_packaging() {
    // The TS twin resolved bundled bins via `createRequire`; the Rust registry
    // takes the node binary + bundled node_modules root explicitly.
    let root = tempfile::tempdir().unwrap();
    let r = LspRegistry::new().with_bundled("/usr/bin/node", root.path());
    let result = r.resolve_command("typescript").await.unwrap();
    assert_eq!(result.command, "/usr/bin/node");
    assert!(result.args[0].contains("typescript-language-server"));
    assert_eq!(result.args.last().unwrap(), "--stdio");
}

#[tokio::test]
async fn resolves_bundled_pyright_server_via_packaging() {
    let root = tempfile::tempdir().unwrap();
    let r = LspRegistry::new().with_bundled("/usr/bin/node", root.path());
    let result = r.resolve_command("python").await.unwrap();
    assert_eq!(result.command, "/usr/bin/node");
    assert!(result.args[0].contains("pyright"));
}

#[tokio::test]
async fn returns_none_for_unknown_language_resolution() {
    assert!(registry().resolve_command("rust").await.is_none());
}

#[tokio::test]
async fn bundled_without_packaging_returns_none() {
    // No `with_bundled` — the daemon has not injected node/node_modules yet.
    assert!(registry().resolve_command("typescript").await.is_none());
}
