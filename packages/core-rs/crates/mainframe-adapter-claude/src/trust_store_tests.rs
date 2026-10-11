use super::*;
use std::io::Write;

fn write_claude_json(contents: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let mut f = std::fs::File::create(dir.path().join(".claude.json")).unwrap();
    f.write_all(contents.as_bytes()).unwrap();
    dir
}

#[tokio::test]
async fn returns_the_oauth_account_uuid_when_present() {
    let dir = write_claude_json(
        r#"{"oauthAccount":{"accountUuid":"uuid-123","emailAddress":"a@b.com"}}"#,
    );
    let identity = read_claude_account_identity(Some(&dir.path().join(".claude.json"))).await;
    assert_eq!(identity, "uuid-123");
}

#[tokio::test]
async fn falls_back_to_email_address_when_account_uuid_is_absent() {
    let dir = write_claude_json(r#"{"oauthAccount":{"emailAddress":"a@b.com"}}"#);
    let identity = read_claude_account_identity(Some(&dir.path().join(".claude.json"))).await;
    assert_eq!(identity, "a@b.com");
}

#[tokio::test]
async fn returns_the_unknown_bucket_when_there_is_no_oauth_account() {
    let dir = write_claude_json(r#"{"projects":{}}"#);
    let identity = read_claude_account_identity(Some(&dir.path().join(".claude.json"))).await;
    assert_eq!(identity, CLAUDE_IDENTITY_UNKNOWN);
}

#[tokio::test]
async fn returns_the_unknown_bucket_when_the_file_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let identity = read_claude_account_identity(Some(&dir.path().join("absent.json"))).await;
    assert_eq!(identity, CLAUDE_IDENTITY_UNKNOWN);
}

#[tokio::test]
async fn returns_the_transient_sentinel_when_the_file_is_malformed_json() {
    let dir = write_claude_json("{ not json");
    let identity = read_claude_account_identity(Some(&dir.path().join(".claude.json"))).await;
    assert_eq!(identity, CLAUDE_IDENTITY_TRANSIENT);
}

#[tokio::test]
async fn write_workspace_trust_creates_the_file_when_it_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(".claude.json");

    write_workspace_trust("/home/me/proj", Some(&path))
        .await
        .unwrap();

    let raw = tokio::fs::read_to_string(&path).await.unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        parsed["projects"]["/home/me/proj"]["hasTrustDialogAccepted"],
        true
    );
}

#[tokio::test]
async fn write_workspace_trust_preserves_other_keys_and_other_projects() {
    let dir = write_claude_json(
        r#"{"oauthAccount":{"accountUuid":"uuid-123"},"projects":{"/other":{"hasTrustDialogAccepted":true,"allowedTools":["Bash"]}}}"#,
    );
    let path = dir.path().join(".claude.json");

    write_workspace_trust("/home/me/proj", Some(&path))
        .await
        .unwrap();

    let raw = tokio::fs::read_to_string(&path).await.unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed["oauthAccount"]["accountUuid"], "uuid-123");
    assert_eq!(parsed["projects"]["/other"]["hasTrustDialogAccepted"], true);
    assert_eq!(parsed["projects"]["/other"]["allowedTools"][0], "Bash");
    assert_eq!(
        parsed["projects"]["/home/me/proj"]["hasTrustDialogAccepted"],
        true
    );
}

#[tokio::test]
async fn write_workspace_trust_preserves_other_fields_on_the_same_project() {
    let dir = write_claude_json(r#"{"projects":{"/home/me/proj":{"allowedTools":["Bash"]}}}"#);
    let path = dir.path().join(".claude.json");

    write_workspace_trust("/home/me/proj", Some(&path))
        .await
        .unwrap();

    let raw = tokio::fs::read_to_string(&path).await.unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        parsed["projects"]["/home/me/proj"]["allowedTools"][0],
        "Bash"
    );
    assert_eq!(
        parsed["projects"]["/home/me/proj"]["hasTrustDialogAccepted"],
        true
    );
}

#[tokio::test]
async fn write_workspace_trust_errors_on_malformed_existing_file_without_clobbering_it() {
    let dir = write_claude_json("{ not json");
    let path = dir.path().join(".claude.json");

    let err = write_workspace_trust("/home/me/proj", Some(&path))
        .await
        .unwrap_err();
    assert!(matches!(err, TrustStoreError::Parse { .. }));

    let raw = tokio::fs::read_to_string(&path).await.unwrap();
    assert_eq!(raw, "{ not json");
}

#[tokio::test]
async fn write_workspace_trust_leaves_no_tmp_file_behind_on_success() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(".claude.json");

    write_workspace_trust("/home/me/proj", Some(&path))
        .await
        .unwrap();

    let entries: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(entries, vec![std::ffi::OsString::from(".claude.json")]);
}
