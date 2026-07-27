//! The manifests that identify a language other than through `pyproject.toml`
//! and `pom.xml`. A Python project on `requirements.txt` and a Java project on
//! Gradle are both ordinary, and neither was detected at all before.

use std::fs;

use mainframe_types::setup_advisor::ProjectFingerprint;
use tempfile::tempdir;

use super::super::detect_root_manifests;
use super::fingerprint_of;

#[tokio::test]
async fn detects_python_and_its_dependencies_from_requirements_txt() {
    let fp = fingerprint_of(&[(
        "requirements.txt",
        "fastapi>=0.110\ndjango==5.0\npytest[testing]~=8.0\n",
    )])
    .await;

    assert!(fp.languages.contains(&"python".to_string()));
    assert!(fp.frameworks.contains(&"fastapi".to_string()));
    assert!(fp.frameworks.contains(&"django".to_string()));
    assert!(fp.testing.contains(&"pytest".to_string()));
}

/// `-r`, `--index-url`, and comments are not requirements. A parser that treats
/// every line as one reports dependencies the project does not have.
#[tokio::test]
async fn reads_no_dependency_out_of_a_comment_or_an_option_line() {
    let fp = fingerprint_of(&[(
        "requirements.txt",
        "# django is deliberately not used here\n--index-url https://example.invalid/fastapi\n-r pytest.txt\n",
    )])
    .await;

    assert!(fp.languages.contains(&"python".to_string()));
    assert!(fp.frameworks.is_empty(), "frameworks: {:?}", fp.frameworks);
    assert!(fp.testing.is_empty(), "testing: {:?}", fp.testing);
}

#[tokio::test]
async fn detects_python_from_the_other_packaging_layouts() {
    for manifest in ["setup.py", "Pipfile"] {
        let fp = fingerprint_of(&[(manifest, "")]).await;

        assert!(
            fp.languages.contains(&"python".to_string()),
            "{manifest} did not identify a Python project"
        );
    }
}

#[tokio::test]
async fn detects_java_from_a_gradle_build() {
    for manifest in ["build.gradle", "build.gradle.kts"] {
        let fp = fingerprint_of(&[(manifest, "plugins { id 'java' }\n")]).await;

        assert!(
            fp.languages.contains(&"java".to_string()),
            "{manifest} did not identify a Java project"
        );
    }
}

/// The presence check reaches the filesystem, so it carries the same containment
/// obligation as a read: a repo can ship `Cargo.toml` as a link to anywhere.
#[tokio::test]
async fn does_not_claim_a_language_from_a_manifest_symlinked_out_of_the_project() {
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("Cargo.toml"), "[package]\n").unwrap();

    let project = tempdir().unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("Cargo.toml"),
        project.path().join("Cargo.toml"),
    )
    .unwrap();
    let mut fp = ProjectFingerprint::default();

    detect_root_manifests(project.path(), &mut fp).await;

    assert!(fp.languages.is_empty(), "languages: {:?}", fp.languages);
}
