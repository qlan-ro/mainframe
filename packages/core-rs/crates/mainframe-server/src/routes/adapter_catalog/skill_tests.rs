use super::*;
use axum::body::to_bytes;

async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

#[cfg(unix)]
#[tokio::test]
async fn list_codex_skills_uses_cli_catalog() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let binary = temp.path().join("codex");
    std::fs::write(&binary, r#"#!/bin/sh
while IFS= read -r line; do
case "$line" in
  *'"method":"initialize"'*) printf '%s\n' '{"id":1,"result":{}}' ;;
  *'"method":"skills/list"'*) printf '%s\n' '{"id":2,"result":{"data":[{"cwd":"/tmp","skills":[{"name":"review","description":"Review code","path":"/tmp/review/SKILL.md","scope":"repo","enabled":true},{"name":"disabled","description":"Hidden","path":"/tmp/hidden/SKILL.md","scope":"user","enabled":false}],"errors":[]}]}}' ;;
esac
done
"#).unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut ctx = AppCtx::test_ctx();
    Arc::get_mut(&mut ctx).unwrap().core.resolved_path =
        mainframe_runtime::ResolvedPath::from_value(temp.path().to_str().unwrap());
    ctx.core
        .adapter_registry
        .register(Arc::new(mainframe_adapter_codex::CodexAdapter::default()));
    let response = list::<true>(
        State(ctx),
        Path("codex".into()),
        Query(ProjectPathQuery {
            project_path: Some("/tmp".into()),
        }),
    )
    .await;
    let (status, body) = read(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(body["data"][0]["name"], "review");
    assert_eq!(body["data"][0]["adapterId"], "codex");
    assert_eq!(body["data"][0]["scope"], "project");
}

#[tokio::test]
async fn list_unknown_adapter_404() {
    let ctx = AppCtx::test_ctx();
    let resp = list::<true>(
        State(ctx.clone()),
        Path("codex".into()),
        Query(ProjectPathQuery {
            project_path: Some("/tmp".into()),
        }),
    )
    .await;
    let (status, body) = read(resp).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], unsupported::<true>());
}

#[tokio::test]
async fn create_unknown_adapter_404() {
    let ctx = AppCtx::test_ctx();
    let resp = create::<true>(
        State(ctx.clone()),
        Path("codex".into()),
        axum::body::Bytes::from("{}"),
    )
    .await;
    assert_eq!(read(resp).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn list_mock_adapter_scans_project_skills() {
    let temp = tempfile::tempdir().unwrap();
    let skill_dir = temp.path().join(".claude/skills/review");
    tokio::fs::create_dir_all(&skill_dir).await.unwrap();
    tokio::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: Review carefully\n---\nBody\n",
    )
    .await
    .unwrap();
    let ctx = AppCtx::test_ctx();
    ctx.core
        .adapter_registry
        .register(Arc::new(mainframe_adapter_mock::MockCliAdapter::default()));

    let response = list::<true>(
        State(ctx),
        Path("mock-cli".into()),
        Query(ProjectPathQuery {
            project_path: Some(temp.path().to_string_lossy().to_string()),
        }),
    )
    .await;
    let (status, body) = read(response).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"][0]["id"], "mock-cli:project:review");
}
