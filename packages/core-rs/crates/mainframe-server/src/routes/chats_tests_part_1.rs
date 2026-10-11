use super::*;
use crate::chat_test_support::StubAdapter;
use mainframe_types::chat::ChatStatus;
use mainframe_types::chat_patch::ChatPatch;
use std::collections::HashMap;

use crate::test_support::read_json as read;

/// Seeds the chats-filter fixture and returns the label→id map (ids are nanoid,
/// so the `c1..c5` labels are captured, not asserted literally).
async fn seed(ctx: &Arc<AppCtx>) -> HashMap<&'static str, String> {
    ctx.core
        .db
        .call(|db| {
            db.projects.create("/tmp/p", Some("p"))?;
            db.projects.create("/tmp/q", Some("q"))?;
            let p1 = db
                .projects
                .list()?
                .into_iter()
                .find(|p| p.path == "/tmp/p")
                .unwrap()
                .id;
            let p2 = db
                .projects
                .list()?
                .into_iter()
                .find(|p| p.path == "/tmp/q")
                .unwrap()
                .id;

            let mut ids: HashMap<&'static str, String> = HashMap::new();
            let mut mk = |label: &'static str,
                          project: &str,
                          worktree: Option<&str>,
                          archived: bool|
             -> Result<(), mainframe_db::DbError> {
                let chat = db.chats.create(&mainframe_types::chat::NewChat {
                    project_id: project.to_string(),
                    adapter_id: "claude".to_string(),
                    ..Default::default()
                })?;
                let update = ChatPatch {
                    worktree_path: Some(worktree.map(str::to_string)),
                    status: archived.then_some(ChatStatus::Archived),
                    ..Default::default()
                };
                db.chats.update(&chat.id, &update)?;
                ids.insert(label, chat.id);
                Ok(())
            };
            mk("c1", &p1, Some("/wt/c1"), false)?;
            mk("c2", &p1, None, false)?;
            mk("c3", &p1, Some("/wt/c3"), false)?;
            mk("c4", &p2, Some("/wt/c4"), false)?;
            mk("c5", &p1, Some("/wt/c5"), true)?;
            db.chat_tags
                .set_for_chat(&ids["c1"], &["feature".to_string()], &db.tags)?;
            db.chat_tags
                .set_for_chat(&ids["c2"], &["feature".to_string()], &db.tags)?;
            db.chat_tags
                .set_for_chat(&ids["c3"], &["bug".to_string()], &db.tags)?;
            Ok(ids)
        })
        .await
        .unwrap()
}

fn q(project: Option<&str>, tags: Option<&str>, synthetic: Option<&str>) -> Query<ListQuery> {
    Query(ListQuery {
        project: project.map(str::to_string),
        tags: tags.map(str::to_string),
        synthetic: synthetic.map(str::to_string),
        include_temporary: None,
    })
}

async fn ids_of(resp: Response) -> Vec<String> {
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::OK);
    let mut ids: Vec<String> = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap().to_string())
        .collect();
    ids.sort();
    ids
}

fn labels(ids: &HashMap<&str, String>, keys: &[&str]) -> Vec<String> {
    let mut v: Vec<String> = keys.iter().map(|k| ids[*k].clone()).collect();
    v.sort();
    v
}

#[tokio::test]
async fn no_filters_returns_all_including_archived() {
    let ctx = AppCtx::test_ctx();
    let ids = seed(&ctx).await;
    let got = ids_of(list(State(ctx.clone()), q(None, None, None)).await).await;
    assert_eq!(got, labels(&ids, &["c1", "c2", "c3", "c4", "c5"]));
}

#[tokio::test]
async fn filters_by_project() {
    let ctx = AppCtx::test_ctx();
    let ids = seed(&ctx).await;
    // resolve p2 via c4's project by querying chats
    let p2 = ctx
        .core
        .db
        .call(|db| {
            Ok(db
                .projects
                .list()?
                .into_iter()
                .find(|p| p.path == "/tmp/q")
                .unwrap()
                .id)
        })
        .await
        .unwrap();
    let got = ids_of(list(State(ctx.clone()), q(Some(&p2), None, None)).await).await;
    assert_eq!(got, labels(&ids, &["c4"]));
}

#[tokio::test]
async fn filters_by_tags() {
    let ctx = AppCtx::test_ctx();
    let ids = seed(&ctx).await;
    let got = ids_of(list(State(ctx.clone()), q(None, Some("feature"), None)).await).await;
    assert_eq!(got, labels(&ids, &["c1", "c2"]));
}

#[tokio::test]
async fn filters_by_synthetic_has_worktree() {
    let ctx = AppCtx::test_ctx();
    let ids = seed(&ctx).await;
    let got = ids_of(list(State(ctx.clone()), q(None, None, Some("has-worktree"))).await).await;
    assert_eq!(got, labels(&ids, &["c1", "c3", "c4", "c5"]));
}

#[tokio::test]
async fn ignores_has_pr_synthetic() {
    let ctx = AppCtx::test_ctx();
    seed(&ctx).await;
    let got = ids_of(list(State(ctx.clone()), q(None, None, Some("has-pr"))).await).await;
    assert_eq!(got.len(), 5);
}

#[tokio::test]
async fn populates_tags_on_filtered_results() {
    let ctx = AppCtx::test_ctx();
    let ids = seed(&ctx).await;
    let (_, body) = read(list(State(ctx.clone()), q(None, Some("feature"), None)).await)
        .await
        .unwrap();
    let c1 = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == serde_json::json!(ids["c1"]))
        .unwrap();
    assert_eq!(c1["tags"], serde_json::json!(["feature"]));
}

#[tokio::test]
async fn rejects_malformed_tags_400() {
    let ctx = AppCtx::test_ctx();
    let (status, _) = read(list(State(ctx.clone()), q(None, Some("feature,BAD!"), None)).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn get_missing_chat_404() {
    let ctx = AppCtx::test_ctx();
    let (status, body) = read(get_one(State(ctx.clone()), Path("nope".into())).await)
        .await
        .unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Chat not found");
}

#[tokio::test]
async fn set_pinned_requires_boolean_400() {
    let ctx = AppCtx::test_ctx();
    let resp = set_pinned(
        State(ctx.clone()),
        Path("c".into()),
        axum::body::Bytes::from("{}"),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "pinned (boolean) is required");
}

#[tokio::test]
async fn set_pinned_refuses_a_temporary_chat_409() {
    let ctx = AppCtx::test_ctx();
    let (_, _, temp_id) = seed_one_temporary_chat(&ctx).await;

    let resp = set_pinned(
        State(ctx.clone()),
        Path(temp_id),
        axum::body::Bytes::from(r#"{"pinned":true}"#),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "cannot pin a temporary chat");
}

#[tokio::test]
async fn set_effort_rejects_bad_level_400() {
    let ctx = AppCtx::test_ctx();
    let resp = set_effort(
        State(ctx.clone()),
        Path("c".into()),
        axum::body::Bytes::from(r#"{"effort":"turbo"}"#),
    )
    .await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "effort must be a valid level or null");
}

/// Pin, not a red test: `parse_effort_field` is pure serde and already
/// accepts `"ultra"`. The chat doesn't exist in `test_ctx`, so the request
/// fails later in `apply_and_return` — this only proves validation cleared.
#[tokio::test]
async fn set_effort_accepts_ultra_past_validation() {
    let ctx = AppCtx::test_ctx();
    let resp = set_effort(
        State(ctx.clone()),
        Path("c".into()),
        axum::body::Bytes::from(r#"{"effort":"ultra"}"#),
    )
    .await;
    let (_, body) = read(resp).await.unwrap();
    assert_ne!(body["error"], "effort must be a valid level or null");
}

#[tokio::test]
async fn tool_result_rejects_bad_tool_use_id_400() {
    let ctx = AppCtx::test_ctx();
    let resp = tool_result(State(ctx.clone()), Path(("c".into(), "bad id!".into()))).await;
    let (status, _) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn tool_result_missing_chat_404() {
    let ctx = AppCtx::test_ctx();
    let resp = tool_result(State(ctx.clone()), Path(("nope".into(), "abc".into()))).await;
    let (status, body) = read(resp).await.unwrap();
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "Chat not found");
}
