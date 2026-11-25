use super::*;
use crate::test_support::{FakePort, announce, service_with};

/// Nothing announces a Stop that had no turn to end, so a flag it left behind
/// would refuse every mutating call of the chat's next turn.
#[tokio::test]
async fn stopping_an_idle_chat_does_not_refuse_its_next_turn() {
    let port = FakePort::new();
    port.add_chat("caller");
    let (svc, ctx) = service_with(port.clone(), "caller");
    svc.cascade_stop("caller", None).await;
    port.update("caller", |c| c.working = true);
    announce(&svc, "caller").await;
    let next_turn = crate::test_support::call_ctx(&svc, "caller");
    assert!(svc.active_caller(&next_turn).await.is_ok());
    assert!(svc.active_caller(&ctx).await.is_err(), "its call was ended");
}

#[tokio::test]
async fn stopping_a_working_chat_refuses_its_calls_until_it_is_idle() {
    let port = FakePort::new();
    port.add_chat("caller");
    port.update("caller", |c| c.working = true);
    let (svc, _) = service_with(port.clone(), "caller");
    svc.cascade_stop("caller", None).await;
    announce(&svc, "caller").await;
    assert!(svc.is_stopping("caller"));
    port.update("caller", |c| c.working = false);
    announce(&svc, "caller").await;
    assert!(!svc.is_stopping("caller"));
}

/// The key must not depend on which tasks are still open: two calls from one
/// tree would otherwise hold different locks.
#[tokio::test]
async fn one_tree_shares_one_key_and_a_creator_cycle_ends() {
    let port = FakePort::new();
    let top = port.add_chat("top");
    port.add_chat("mid");
    port.update("mid", |c| c.created_by_chat_id = Some("top".into()));
    port.add_chat("leaf");
    port.update("leaf", |c| c.created_by_chat_id = Some("mid".into()));
    let (svc, _) = service_with(port.clone(), "top");
    let leaf = port.lock().chats["leaf"].clone();
    assert_eq!(svc.tree_key(&top).await.unwrap(), "top");
    assert_eq!(svc.tree_key(&leaf).await.unwrap(), "top");
    assert_eq!(svc.depth_of(&leaf).await.unwrap(), 2);

    port.update("top", |c| c.created_by_chat_id = Some("leaf".into()));
    assert_eq!(svc.depth_of(&leaf).await.unwrap(), MAX_DEPTH + 1);
}
