use axum::body::to_bytes;
use axum::extract::Query;

use super::*;
use crate::routes::chat_discard::refuse_if_temporary;
use crate::routes::chats::{ListForProjectQuery, ListQuery, get_one, list, list_for_project};
use mainframe_db::chats::ChatListFilters;
use mainframe_types::chat::{Chat, NewChat};

async fn read(resp: Response) -> (StatusCode, serde_json::Value) {
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

async fn open(ctx: &Arc<AppCtx>, id: &str, body: &'static [u8]) -> (StatusCode, serde_json::Value) {
    read(
        open_side_chat(
            State(ctx.clone()),
            Path(id.to_string()),
            Bytes::from_static(body),
        )
        .await,
    )
    .await
}

/// A real project + parent chat, registered under the `claude` StubAdapter
/// (fork: false), through a real `ChatManager` (todo #346's AC 26 harness).
async fn setup() -> (Arc<AppCtx>, mainframe_types::chat::Project, Chat) {
    // `enrich_chat`'s directory-missing check stats the real filesystem, so
    // the project's path must actually exist for open_side_chat's OWN
    // gating (the archived/side-chat/id checks) to be what each test below
    // is really about.
    std::fs::create_dir_all("/tmp/side-chat-route").unwrap();
    let ctx = crate::ctx::AppCtx::test_ctx_with_chat_manager();
    ctx.adapter_registry
        .register(crate::chat_test_support::StubAdapter::new("claude", false));
    let project = ctx
        .db
        .call(|db| db.projects.create("/tmp/side-chat-route", None))
        .await
        .unwrap();
    let parent = ctx
        .chat_manager
        .as_ref()
        .unwrap()
        .create_chat_with_defaults(
            NewChat {
                project_id: project.id.clone(),
                adapter_id: "claude".to_string(),
                ..Default::default()
            },
            None,
            None,
        )
        .await;
    (ctx, project, parent)
}

// ── 400s ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_bad_id_400s() {
    let ctx = AppCtx::test_ctx();
    let (status, _) = open(&ctx, "not a valid id!", b"").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn an_unknown_body_field_400s() {
    let ctx = AppCtx::test_ctx();
    let (status, _) = open(&ctx, "c1", br#"{"foo":1}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn an_empty_body_is_accepted() {
    let (ctx, _project, parent) = setup().await;
    let (status, _) = open(&ctx, &parent.id, b"{}").await;
    assert_eq!(status, StatusCode::OK);
}

// ── 404 / 409 envelopes ──────────────────────────────────────────────────

#[tokio::test]
async fn an_unknown_parent_404s() {
    let ctx = AppCtx::test_ctx_with_chat_manager();
    let (status, body) = open(&ctx, "nope", b"").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(body["error"].as_str().unwrap().contains("not found"));
}

#[tokio::test]
async fn an_archived_parent_409s() {
    let (ctx, _project, parent) = setup().await;
    ctx.chat_manager
        .as_ref()
        .unwrap()
        .archive_chat(&parent.id, false)
        .await;

    let (status, _) = open(&ctx, &parent.id, b"").await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn a_side_chat_cannot_open_its_own_side_chat_409s() {
    let (ctx, _project, parent) = setup().await;
    let (status, body) = open(&ctx, &parent.id, b"").await;
    assert_eq!(status, StatusCode::OK);
    let side_id = body["data"]["id"].as_str().unwrap().to_string();

    let (status, _) = open(&ctx, &side_id, b"").await;
    assert_eq!(status, StatusCode::CONFLICT);
}

// ── open / reveal ────────────────────────────────────────────────────────

#[tokio::test]
async fn opening_twice_reveals_the_same_side_chat() {
    let (ctx, _project, parent) = setup().await;
    let (status, first) = open(&ctx, &parent.id, b"").await;
    assert_eq!(status, StatusCode::OK);
    let (status, second) = open(&ctx, &parent.id, b"").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first["data"]["id"], second["data"]["id"]);
}

#[tokio::test]
async fn two_concurrent_opens_leave_one_row() {
    let (ctx, project, parent) = setup().await;
    let (a, b) = tokio::join!(
        open_side_chat(
            State(ctx.clone()),
            Path(parent.id.clone()),
            Bytes::from_static(b"")
        ),
        open_side_chat(
            State(ctx.clone()),
            Path(parent.id.clone()),
            Bytes::from_static(b"")
        ),
    );
    let (status_a, body_a) = read(a).await;
    let (status_b, body_b) = read(b).await;
    assert_eq!(status_a, StatusCode::OK);
    assert_eq!(status_b, StatusCode::OK);
    assert_eq!(body_a["data"]["id"], body_b["data"]["id"]);

    let project_id = project.id.clone();
    let rows = ctx
        .db
        .call(move |db| db.chats.list(&project_id))
        .await
        .unwrap();
    let side_chats = rows.iter().filter(|c| c.temporary).count();
    assert_eq!(side_chats, 1, "exactly one side-chat row must exist");
}

// ── listing exclusion (rule 7) ───────────────────────────────────────────

#[tokio::test]
async fn list_filtered_excludes_the_side_chat_with_and_without_include_temporary_while_get_chat_returns_it()
 {
    let (ctx, project, parent) = setup().await;
    let (_, body) = open(&ctx, &parent.id, b"").await;
    let side_id = body["data"]["id"].as_str().unwrap().to_string();
    let cm = ctx.chat_manager.as_ref().unwrap();

    let default_list = cm.list_filtered(Some(&project.id), None, false, true, false);
    assert!(!default_list.iter().any(|c| c.id == side_id));

    let with_temporary = cm.list_filtered(Some(&project.id), None, false, true, true);
    assert!(!with_temporary.iter().any(|c| c.id == side_id));

    assert!(cm.get_chat(&side_id).is_some());
}

#[tokio::test]
async fn filter_temporary_drops_a_side_chat_even_when_include_temporary_is_set() {
    // Pure unit coverage of the DB-level exclusion (mainframe-db rule 7)
    // through the same filters the wired `list` route builds.
    std::fs::create_dir_all("/tmp/side-chat-filtered").unwrap();
    let ctx = AppCtx::test_ctx_with_chat_manager();
    ctx.adapter_registry
        .register(crate::chat_test_support::StubAdapter::new("claude", false));
    let project = ctx
        .db
        .call(|db| db.projects.create("/tmp/side-chat-filtered", None))
        .await
        .unwrap();
    let parent = ctx
        .chat_manager
        .as_ref()
        .unwrap()
        .create_chat_with_defaults(
            NewChat {
                project_id: project.id.clone(),
                adapter_id: "claude".to_string(),
                ..Default::default()
            },
            None,
            None,
        )
        .await;
    ctx.chat_manager
        .as_ref()
        .unwrap()
        .open_side_chat(&parent.id)
        .await
        .unwrap();

    let project_id = project.id.clone();
    let rows = ctx
        .db
        .call(move |db| {
            db.chats.list_filtered(&ChatListFilters {
                project_id: Some(project_id),
                include_temporary: true,
                ..Default::default()
            })
        })
        .await
        .unwrap();
    assert!(
        rows.iter()
            .all(|c| !(c.temporary && c.parent_chat_id.is_some()))
    );
}

// ── refusals already in place (rule 8) ──────────────────────────────────

fn side_chat_fixture() -> Chat {
    let mut chat = crate::chat_deps::fallback_chat(&NewChat {
        project_id: "p1".to_string(),
        adapter_id: "claude".to_string(),
        temporary: true,
        ..Default::default()
    });
    chat.id = "side-1".to_string();
    chat.parent_chat_id = Some(Some("c1".to_string()));
    chat
}

#[test]
fn pin_tag_archive_and_unarchive_all_refuse_a_side_chat() {
    let chat = side_chat_fixture();
    for action in ["pin", "tag", "archive", "unarchive"] {
        assert!(
            refuse_if_temporary(&chat, action).is_some(),
            "{action} must refuse a side chat"
        );
    }
}

#[tokio::test]
async fn fork_refuses_a_side_chat() {
    let (ctx, _project, parent) = setup().await;
    let (_, body) = open(&ctx, &parent.id, b"").await;
    let side_id = body["data"]["id"].as_str().unwrap().to_string();

    let err = ctx
        .chat_manager
        .as_ref()
        .unwrap()
        .fork_chat(&side_id, mainframe_chat::chat_manager::ForkPoint::Current)
        .await
        .unwrap_err();
    // StubAdapter isn't fork-capable, so this may surface as Unsupported
    // rather than Temporary — either way, fork never succeeds for a side chat.
    assert_ne!(err.status_code(), 200);
}

// ── project removal cascade (rule 6) ────────────────────────────────────

#[tokio::test]
async fn removing_the_project_deletes_the_side_chats_row() {
    let (ctx, project, parent) = setup().await;
    let (_, body) = open(&ctx, &parent.id, b"").await;
    let side_id = body["data"]["id"].as_str().unwrap().to_string();
    let cm = ctx.chat_manager.as_ref().unwrap();

    cm.remove_project(&project.id).await.unwrap();

    assert!(cm.get_chat(&parent.id).is_none());
    assert!(cm.get_chat(&side_id).is_none());
}

// ── side chats are never listed, even with includeTemporary (todo #344,
// rule 7) — moved here from routes/chats.rs (review, keeps that file under
// the 1000-line gate); exercises `chats::list`/`list_for_project`/`get_one`
// directly since those routes, not this one, own the listing exclusion. ────

fn q(project: Option<&str>, tags: Option<&str>, synthetic: Option<&str>) -> Query<ListQuery> {
    Query(ListQuery {
        project: project.map(str::to_string),
        tags: tags.map(str::to_string),
        synthetic: synthetic.map(str::to_string),
        include_temporary: None,
    })
}

async fn ids_of(resp: Response) -> Vec<String> {
    let (status, body) = read(resp).await;
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

async fn seed_a_side_chat(ctx: &Arc<AppCtx>) -> (String, String, String) {
    ctx.db
        .call(|db| {
            let project = db.projects.create("/tmp/side-chat-list", None)?;
            let parent = db.chats.create(&mainframe_types::chat::NewChat {
                project_id: project.id.clone(),
                adapter_id: "claude".to_string(),
                ..Default::default()
            })?;
            let (side, _created) = db.chats.find_or_create_side_chat(&parent)?;
            Ok((project.id, parent.id, side.id))
        })
        .await
        .unwrap()
}

#[tokio::test]
async fn list_never_returns_a_side_chat_with_or_without_include_temporary() {
    let ctx = AppCtx::test_ctx();
    let (_, parent_id, side_id) = seed_a_side_chat(&ctx).await;

    let excluded = ids_of(list(State(ctx.clone()), q(None, None, None)).await).await;
    assert!(excluded.contains(&parent_id));
    assert!(!excluded.contains(&side_id));

    let included = ids_of(
        list(
            State(ctx.clone()),
            Query(ListQuery {
                project: None,
                tags: None,
                synthetic: None,
                include_temporary: Some(true),
            }),
        )
        .await,
    )
    .await;
    assert!(!included.contains(&side_id));
}

#[tokio::test]
async fn list_for_project_never_returns_a_side_chat_with_or_without_include_temporary() {
    let ctx = AppCtx::test_ctx();
    let (project_id, parent_id, side_id) = seed_a_side_chat(&ctx).await;

    let excluded = ids_of(
        list_for_project(
            State(ctx.clone()),
            Path(project_id.clone()),
            Query(ListForProjectQuery {
                include_temporary: None,
            }),
        )
        .await,
    )
    .await;
    assert!(excluded.contains(&parent_id));
    assert!(!excluded.contains(&side_id));

    let included = ids_of(
        list_for_project(
            State(ctx.clone()),
            Path(project_id),
            Query(ListForProjectQuery {
                include_temporary: Some(true),
            }),
        )
        .await,
    )
    .await;
    assert!(!included.contains(&side_id));
}

#[tokio::test]
async fn get_one_still_returns_a_side_chat_directly() {
    let ctx = AppCtx::test_ctx();
    let (_, _parent_id, side_id) = seed_a_side_chat(&ctx).await;
    let (status, body) = read(get_one(State(ctx.clone()), Path(side_id.clone())).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["id"], side_id);
}
