//! Tests for root-manifest detection.

use super::*;
use mainframe_types::setup_advisor::ProjectFingerprint;
use std::fs;
use tempfile::tempdir;

/// The non-`pyproject.toml`, non-`pom.xml` ways a project names its language.
mod languages;
/// What detection refuses to read.
mod limits;

/// Writes each `(relative_path, contents)` pair into a fresh tempdir (creating
/// parent dirs as needed), runs detection against it, and returns the result.
async fn fingerprint_of(files: &[(&str, &str)]) -> ProjectFingerprint {
    let tmp = tempdir().unwrap();
    for (path, contents) in files {
        let full = tmp.path().join(path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(full, contents).unwrap();
    }
    let mut fp = ProjectFingerprint::default();
    detect_root_manifests(tmp.path(), &mut fp).await;
    fp
}

#[tokio::test]
async fn detects_js_languages_frameworks_databases_and_testing_from_package_json() {
    let fp = fingerprint_of(&[(
        "package.json",
        r#"{
            "dependencies": {
                "next": "14.0.0",
                "react": "18.2.0",
                "@supabase/supabase-js": "2.0.0"
            },
            "devDependencies": {
                "vitest": "1.0.0",
                "@playwright/test": "1.40.0",
                "typescript": "5.5.0"
            }
        }"#,
    )])
    .await;

    // typescript is claimed from the devDependency above, not merely from parsing package.json.
    assert!(fp.languages.contains(&"typescript".to_string()));
    assert!(fp.frameworks.contains(&"react".to_string()));
    assert!(fp.frameworks.contains(&"nextjs".to_string()));
    assert!(fp.databases.contains(&"supabase".to_string()));
    assert!(fp.testing.contains(&"vitest".to_string()));
    assert!(fp.testing.contains(&"playwright".to_string()));
}

#[tokio::test]
async fn detects_auth_libraries_as_external_apis() {
    let fp = fingerprint_of(&[(
        "package.json",
        r#"{
            "dependencies": {
                "next-auth": "4.0.0",
                "@clerk/nextjs": "5.0.0",
                "@auth0/auth0-react": "2.0.0",
                "passport": "0.7.0"
            }
        }"#,
    )])
    .await;

    // Canonical labels, not raw dependency names: the rules dataset predicates
    // on these, and the spec's ProjectFingerprint documents them as such.
    assert!(fp.external_apis.contains(&"next-auth".to_string()));
    assert!(fp.external_apis.contains(&"clerk".to_string()));
    assert!(fp.external_apis.contains(&"auth0".to_string()));
    assert!(fp.external_apis.contains(&"passport".to_string()));
}

#[tokio::test]
async fn detects_infra_and_database_libraries_from_package_json() {
    let fp = fingerprint_of(&[(
        "package.json",
        r#"{
            "dependencies": {
                "stripe": "14.0.0",
                "@aws-sdk/client-s3": "3.0.0",
                "@sentry/node": "7.0.0",
                "@anthropic-ai/sdk": "0.20.0",
                "openai": "4.0.0",
                "langchain": "0.1.0",
                "prisma": "5.0.0",
                "drizzle-orm": "0.29.0",
                "convex": "1.0.0",
                "pg": "8.0.0"
            }
        }"#,
    )])
    .await;

    assert!(fp.external_apis.contains(&"stripe".to_string()));
    assert!(fp.external_apis.contains(&"aws".to_string()));
    assert!(fp.external_apis.contains(&"sentry".to_string()));
    assert!(fp.external_apis.contains(&"anthropic".to_string()));
    assert!(fp.external_apis.contains(&"openai".to_string()));
    assert!(fp.external_apis.contains(&"langchain".to_string()));
    assert!(fp.databases.contains(&"prisma".to_string()));
    assert!(fp.databases.contains(&"drizzle".to_string()));
    assert!(fp.databases.contains(&"convex".to_string()));
    assert!(fp.databases.contains(&"postgres".to_string()));
}

#[tokio::test]
async fn detects_python_frameworks_and_testing_from_pep_621_pyproject() {
    let fp = fingerprint_of(&[(
        "pyproject.toml",
        r#"
[project]
name = "demo"
dependencies = ["fastapi", "django"]

[project.optional-dependencies]
dev = ["pytest"]
"#,
    )])
    .await;

    assert!(fp.languages.contains(&"python".to_string()));
    assert!(fp.frameworks.contains(&"fastapi".to_string()));
    assert!(fp.frameworks.contains(&"django".to_string()));
    assert!(fp.testing.contains(&"pytest".to_string()));
}

#[tokio::test]
async fn detects_python_frameworks_and_testing_from_poetry_pyproject() {
    let fp = fingerprint_of(&[(
        "pyproject.toml",
        r#"
[tool.poetry]
name = "demo"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.110"

[tool.poetry.group.dev.dependencies]
pytest = "^8"
"#,
    )])
    .await;

    assert!(fp.languages.contains(&"python".to_string()));
    assert!(fp.frameworks.contains(&"fastapi".to_string()));
    assert!(fp.testing.contains(&"pytest".to_string()));
}

#[tokio::test]
async fn detects_rust_go_and_java_from_bare_manifests() {
    let rust_fp = fingerprint_of(&[(
        "Cargo.toml",
        "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n",
    )])
    .await;
    assert!(rust_fp.languages.contains(&"rust".to_string()));

    let go_fp = fingerprint_of(&[("go.mod", "module demo\n\ngo 1.22\n")]).await;
    assert!(go_fp.languages.contains(&"go".to_string()));

    let java_fp = fingerprint_of(&[("pom.xml", "<project></project>\n")]).await;
    assert!(java_fp.languages.contains(&"java".to_string()));
}

#[tokio::test]
async fn tolerates_a_malformed_package_json_and_detects_nothing_from_it() {
    let fp = fingerprint_of(&[("package.json", "{ not json")]).await;

    assert!(fp.languages.is_empty());
    assert!(fp.frameworks.is_empty());
    assert!(fp.databases.is_empty());
    assert!(fp.external_apis.is_empty());
    assert!(fp.testing.is_empty());
}

#[tokio::test]
async fn tolerates_a_malformed_pyproject_toml_and_detects_nothing_from_it() {
    let fp = fingerprint_of(&[("pyproject.toml", "{ not toml")]).await;

    assert!(fp.languages.is_empty());
    assert!(fp.frameworks.is_empty());
    assert!(fp.testing.is_empty());
}

#[tokio::test]
async fn ignores_a_package_json_in_a_subdirectory() {
    let fp = fingerprint_of(&[(
        "sub/package.json",
        r#"{ "dependencies": { "next": "14.0.0", "react": "18.2.0" } }"#,
    )])
    .await;

    assert!(fp.languages.is_empty());
    assert!(fp.frameworks.is_empty());
}

#[tokio::test]
async fn does_not_follow_a_root_package_json_symlink_outside_the_project() {
    // Security: a plain read_to_string would follow the symlink out of the
    // project root, letting a cloned repo's manifest be read from anywhere
    // on disk. The fixture below WOULD populate react/nextjs if followed.
    let outside = tempdir().unwrap();
    fs::write(
        outside.path().join("package.json"),
        r#"{ "dependencies": { "next": "14.0.0", "react": "18.2.0" } }"#,
    )
    .unwrap();

    let project = tempdir().unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("package.json"),
        project.path().join("package.json"),
    )
    .unwrap();
    let mut fp = ProjectFingerprint::default();

    detect_root_manifests(project.path(), &mut fp).await;

    assert!(fp.languages.is_empty());
    assert!(fp.frameworks.is_empty());
    assert!(fp.databases.is_empty());
    assert!(fp.external_apis.is_empty());
    assert!(fp.testing.is_empty());
}

#[tokio::test]
async fn does_not_claim_typescript_for_a_plain_javascript_package_json() {
    let fp = fingerprint_of(&[(
        "package.json",
        r#"{
            "dependencies": {
                "react": "18.2.0"
            }
        }"#,
    )])
    .await;

    assert!(!fp.languages.contains(&"typescript".to_string()));
    assert!(fp.frameworks.contains(&"react".to_string()));
}

#[tokio::test]
async fn claims_typescript_from_a_root_tsconfig_with_no_typescript_dependency() {
    let fp = fingerprint_of(&[
        (
            "package.json",
            r#"{
            "dependencies": {
                "react": "18.2.0"
            }
        }"#,
        ),
        ("tsconfig.json", "{}"),
    ])
    .await;

    assert!(fp.languages.contains(&"typescript".to_string()));
}

#[tokio::test]
async fn claims_typescript_from_a_root_tsconfig_with_no_package_json() {
    let fp = fingerprint_of(&[("tsconfig.json", "{}")]).await;

    assert!(fp.languages.contains(&"typescript".to_string()));
}
