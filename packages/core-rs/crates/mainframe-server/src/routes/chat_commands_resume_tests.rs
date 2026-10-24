use super::*;
use crate::test_support::read_json;

#[test]
fn viewing_query_opts_in_and_omitting_it_keeps_the_full_resume_contract() {
    let full =
        Query::<ResumeQuery>::try_from_uri(&"/api/chats/chat/resume".parse().unwrap()).unwrap();
    assert!(full.wait_for.is_none());
    assert!(!full.initial_window);
    let ready = Query::<ResumeQuery>::try_from_uri(
        &"/api/chats/chat/resume?waitFor=transcript".parse().unwrap(),
    )
    .unwrap();
    assert!(matches!(ready.wait_for, Some(ResumeWaitFor::Transcript)));
    assert!(!ready.initial_window);
    let tail = Query::<ResumeQuery>::try_from_uri(
        &"/api/chats/chat/resume?waitFor=transcript&initialWindow=true"
            .parse()
            .unwrap(),
    )
    .unwrap();
    assert!(tail.initial_window);
    assert!(
        Query::<ResumeQuery>::try_from_uri(
            &"/api/chats/chat/resume?waitFor=unknown".parse().unwrap()
        )
        .is_err()
    );
}

#[tokio::test]
async fn both_modes_reject_a_missing_chat_before_starting_background_work() {
    let ctx = AppCtx::test_ctx();
    for wait_for in [None, Some(ResumeWaitFor::Transcript)] {
        let (status, _) = read_json(
            resume(
                State(ctx.clone()),
                Path("missing-chat".into()),
                Query(ResumeQuery {
                    wait_for,
                    initial_window: false,
                }),
            )
            .await,
        )
        .await
        .unwrap();
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}
