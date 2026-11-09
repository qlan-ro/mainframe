use super::*;
use mainframe_adapter_claude::artifact_client::ArtifactFile;

fn listing(from_type: bool, paths: &[(&str, u64)]) -> ArtifactListing {
    ArtifactListing {
        version: "1".to_string(),
        from_type,
        files: paths
            .iter()
            .map(|(path, size_bytes)| ArtifactFile {
                path: (*path).to_string(),
                size_bytes: *size_bytes,
            })
            .collect(),
    }
}

#[test]
fn a_design_downloads_its_project_and_the_real_runtime() {
    let design = listing(
        true,
        &[
            ("SKILL.md", 1),
            ("index.html", 1),
            ("artifact-type/app.js", 1),
            ("artifact-type/dc-runtime.js", 1),
            ("project/README.md", 1),
            ("project/canvas.json", 1),
            ("project/Main.dc.html", 1),
        ],
    );
    assert_eq!(
        files_to_download(&design),
        Some(vec![
            "project/canvas.json".to_string(),
            "project/Main.dc.html".to_string(),
            "artifact-type/dc-runtime.js".to_string(),
        ])
    );
}

#[test]
fn a_design_system_is_left_to_claude_ai() {
    let system = listing(
        true,
        &[
            ("project/components/Alert/preview.html", 1),
            ("project/tokens.json", 1),
        ],
    );
    assert_eq!(files_to_download(&system), None);
}

#[test]
fn a_migrated_design_downloads_its_pages_and_their_code() {
    let migrated = listing(
        true,
        &[
            ("index.html", 1),
            ("artifact-type/app.js", 1),
            ("project/Chat redesign.html", 1),
            ("project/chat-app.jsx", 1),
            ("project/.design-canvas.state.json", 1),
            ("project/notes.md", 1),
        ],
    );
    assert_eq!(
        files_to_download(&migrated),
        Some(vec![
            "project/Chat redesign.html".to_string(),
            "project/chat-app.jsx".to_string(),
            "project/.design-canvas.state.json".to_string(),
        ])
    );
    let paths = ["project/A.html", "project/sub/B.html", "project/app.jsx"].map(str::to_string);
    assert_eq!(migrated_pages(&paths), vec!["project/A.html"]);
}

#[test]
fn docs_and_dashboards_keep_their_content_in_the_database() {
    let docs = listing(
        true,
        &[
            ("index.html", 1),
            ("SKILL.md", 1),
            ("artifact-type/app.js", 1),
        ],
    );
    assert_eq!(files_to_download(&docs), None);
}

#[test]
fn an_untyped_artifact_is_its_own_page() {
    assert_eq!(
        files_to_download(&listing(false, &[])),
        Some(vec!["index.html".to_string()])
    );
    assert_eq!(
        files_to_download(&listing(false, &[("index.html", 1), ("app.js", 1)])),
        Some(vec!["index.html".to_string(), "app.js".to_string()])
    );
}

#[test]
fn an_oversized_artifact_is_left_to_claude_ai() {
    let huge = listing(true, &[("project/canvas.json", MAX_ARTIFACT_BYTES + 1)]);
    assert_eq!(files_to_download(&huge), None);
}

#[test]
fn only_plain_relative_paths_are_safe() {
    assert!(safe_relative("project/Main.dc.html").is_some());
    assert!(safe_relative("../secret").is_none());
    assert!(safe_relative("project/../../secret").is_none());
    assert!(safe_relative("/etc/passwd").is_none());
    assert!(safe_relative("").is_none());
}

#[tokio::test]
async fn a_saved_file_outside_the_scratch_folder_is_refused() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = std::fs::canonicalize(dir.path()).expect("canonical");
    let spool = root.join("spool");
    std::fs::create_dir(&spool).expect("mkdir");
    std::fs::write(root.join("outside.html"), "secret").expect("write");
    let saved = SavedArtifact {
        title: None,
        saved_dir: spool.clone(),
        files: vec![mainframe_adapter_claude::artifact_client::SavedFile {
            path: "project/a.html".to_string(),
            saved_to: root.join("outside.html"),
        }],
    };
    let target = root.join("target");

    assert!(copy_saved(&saved, &target, &spool).await.is_err());
    assert!(!target.join("project/a.html").exists());
}

#[tokio::test]
async fn a_listed_path_cannot_escape_the_cache() {
    let dir = tempfile::tempdir().expect("tempdir");
    let spool = std::fs::canonicalize(dir.path()).expect("canonical");
    std::fs::write(spool.join("a.html"), "page").expect("write");
    let saved = SavedArtifact {
        title: None,
        saved_dir: spool.clone(),
        files: vec![mainframe_adapter_claude::artifact_client::SavedFile {
            path: "../escaped.html".to_string(),
            saved_to: spool.join("a.html"),
        }],
    };

    assert!(
        copy_saved(&saved, &spool.join("target"), &spool)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn only_the_kept_version_survives_a_prune() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir(dir.path().join("old")).expect("mkdir");
    std::fs::create_dir(dir.path().join("new")).expect("mkdir");

    prune_other_versions(dir.path(), "new").await;

    assert!(dir.path().join("new").is_dir());
    assert!(!dir.path().join("old").exists());
}

#[tokio::test]
async fn losing_a_download_race_keeps_the_winner_and_drops_the_temp() {
    let dir = tempfile::tempdir().expect("tempdir");
    let temp = dir.path().join(".download");
    let version = dir.path().join("slug/1");
    std::fs::create_dir(&temp).expect("mkdir");
    std::fs::create_dir_all(&version).expect("mkdir");
    std::fs::write(version.join("kept.html"), "winner").expect("write");
    std::fs::write(temp.join("other.html"), "loser").expect("write");

    publish_version(&temp, &version).await.expect("published");

    assert!(version.join("kept.html").exists());
    assert!(!temp.exists());
}
