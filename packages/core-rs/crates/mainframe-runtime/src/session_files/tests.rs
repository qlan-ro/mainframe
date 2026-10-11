use super::*;

#[test]
fn encodes_project_path_into_claude_projects_directory() {
    let result = get_claude_project_dir("/Users/foo/my-project");
    let expected = dirs::home_dir()
        .unwrap()
        .join(".claude")
        .join("projects")
        .join("-Users-foo-my-project");
    assert_eq!(result, expected);
}

#[test]
fn replaces_non_alphanumeric_characters_except_hyphens() {
    let result = get_claude_project_dir("/tmp/test.dir/sub");
    let expected = dirs::home_dir()
        .unwrap()
        .join(".claude")
        .join("projects")
        .join("-tmp-test-dir-sub");
    assert_eq!(result, expected);
}

const SESSION_ID: &str = "abc-123";

async fn setup_source_dir() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let base = tempfile::tempdir().unwrap();
    let src_base = base.path().join("source");
    let tgt_base = base.path().join("target");

    tokio::fs::create_dir_all(&src_base).await.unwrap();
    tokio::fs::write(
        src_base.join(format!("{SESSION_ID}.jsonl")),
        "{\"sessionId\":\"abc-123\"}\n",
    )
    .await
    .unwrap();

    tokio::fs::create_dir_all(src_base.join(SESSION_ID).join("subagents"))
        .await
        .unwrap();
    tokio::fs::write(
        src_base
            .join(SESSION_ID)
            .join("subagents")
            .join("agent-a1.jsonl"),
        "subagent data",
    )
    .await
    .unwrap();
    tokio::fs::write(
        src_base
            .join(SESSION_ID)
            .join("subagents")
            .join("agent-a1.meta.json"),
        "{}",
    )
    .await
    .unwrap();
    tokio::fs::create_dir_all(src_base.join(SESSION_ID).join("tool-results"))
        .await
        .unwrap();
    tokio::fs::write(
        src_base
            .join(SESSION_ID)
            .join("tool-results")
            .join("toolu_01.txt"),
        "tool output",
    )
    .await
    .unwrap();

    tokio::fs::write(
        src_base.join("sidechain-999.jsonl"),
        format!("{{\"sessionId\":\"{SESSION_ID}\"}}\n"),
    )
    .await
    .unwrap();

    tokio::fs::write(
        src_base.join("other-session.jsonl"),
        "{\"sessionId\":\"other\"}\n",
    )
    .await
    .unwrap();

    (base, src_base, tgt_base)
}

#[tokio::test]
async fn moves_jsonl_session_dir_and_sidechain_files_to_target() {
    let (_base, src_base, tgt_base) = setup_source_dir().await;

    move_session_files(
        SESSION_ID,
        src_base.to_str().unwrap(),
        tgt_base.to_str().unwrap(),
    )
    .await
    .unwrap();

    assert!(tgt_base.join(format!("{SESSION_ID}.jsonl")).exists());
    assert!(tgt_base.join(SESSION_ID).exists());
    assert!(tgt_base.join("sidechain-999.jsonl").exists());

    let content = tokio::fs::read_to_string(
        tgt_base
            .join(SESSION_ID)
            .join("subagents")
            .join("agent-a1.jsonl"),
    )
    .await
    .unwrap();
    assert_eq!(content, "subagent data");

    assert!(!src_base.join(format!("{SESSION_ID}.jsonl")).exists());
    assert!(!src_base.join(SESSION_ID).exists());
    assert!(!src_base.join("sidechain-999.jsonl").exists());

    let other = tokio::fs::read_to_string(src_base.join("other-session.jsonl"))
        .await
        .unwrap();
    assert!(other.contains("other"));
}

#[tokio::test]
async fn works_when_main_jsonl_was_already_relocated() {
    let (_base, src_base, tgt_base) = setup_source_dir().await;
    // The CLI's EnterWorktree relocates the transcript itself, so by the time
    // the daemon rebinds the chat the main JSONL is gone from the source dir.
    tokio::fs::remove_file(src_base.join(format!("{SESSION_ID}.jsonl")))
        .await
        .unwrap();

    move_session_files(
        SESSION_ID,
        src_base.to_str().unwrap(),
        tgt_base.to_str().unwrap(),
    )
    .await
    .unwrap();

    assert!(!tgt_base.join(format!("{SESSION_ID}.jsonl")).exists());
    assert!(tgt_base.join(SESSION_ID).exists());
    assert!(tgt_base.join("sidechain-999.jsonl").exists());
}

#[tokio::test]
async fn keeps_the_transcript_already_in_the_target_dir() {
    let (_base, src_base, tgt_base) = setup_source_dir().await;
    // A dying CLI can recreate a stub in the source dir after the real
    // transcript was relocated, so the copy in the target is the live one.
    tokio::fs::write(src_base.join(format!("{SESSION_ID}.jsonl")), "stale stub")
        .await
        .unwrap();
    tokio::fs::create_dir_all(&tgt_base).await.unwrap();
    tokio::fs::write(
        tgt_base.join(format!("{SESSION_ID}.jsonl")),
        "the relocated transcript",
    )
    .await
    .unwrap();

    move_session_files(
        SESSION_ID,
        src_base.to_str().unwrap(),
        tgt_base.to_str().unwrap(),
    )
    .await
    .unwrap();

    let kept = tokio::fs::read_to_string(tgt_base.join(format!("{SESSION_ID}.jsonl")))
        .await
        .unwrap();
    assert_eq!(kept, "the relocated transcript");
    assert!(tgt_base.join(SESSION_ID).exists());
    assert!(tgt_base.join("sidechain-999.jsonl").exists());
}

#[tokio::test]
async fn keeps_a_sidechain_already_in_the_target_and_moves_the_others() {
    let (_base, src_base, tgt_base) = setup_source_dir().await;
    tokio::fs::write(
        src_base.join("sidechain-aaa.jsonl"),
        format!("{{\"sessionId\":\"{SESSION_ID}\"}}\n"),
    )
    .await
    .unwrap();
    tokio::fs::create_dir_all(&tgt_base).await.unwrap();
    tokio::fs::write(
        tgt_base.join("sidechain-999.jsonl"),
        "the relocated sidechain",
    )
    .await
    .unwrap();

    move_session_files(
        SESSION_ID,
        src_base.to_str().unwrap(),
        tgt_base.to_str().unwrap(),
    )
    .await
    .unwrap();

    let kept = tokio::fs::read_to_string(tgt_base.join("sidechain-999.jsonl"))
        .await
        .unwrap();
    assert_eq!(kept, "the relocated sidechain");
    // A collision on one sidechain must not abandon the rest of the sweep.
    assert!(tgt_base.join("sidechain-aaa.jsonl").exists());
    assert!(tgt_base.join(format!("{SESSION_ID}.jsonl")).exists());
}

#[tokio::test]
async fn works_when_session_directory_does_not_exist() {
    let base = tempfile::tempdir().unwrap();
    let src_base = base.path().join("source");
    let tgt_base = base.path().join("target");
    tokio::fs::create_dir_all(&src_base).await.unwrap();
    tokio::fs::write(
        src_base.join(format!("{SESSION_ID}.jsonl")),
        "{\"sessionId\":\"abc-123\"}\n",
    )
    .await
    .unwrap();

    move_session_files(
        SESSION_ID,
        src_base.to_str().unwrap(),
        tgt_base.to_str().unwrap(),
    )
    .await
    .unwrap();

    let content = tokio::fs::read_to_string(tgt_base.join(format!("{SESSION_ID}.jsonl")))
        .await
        .unwrap();
    assert!(content.contains("abc-123"));
}
