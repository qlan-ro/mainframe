//! The daemon's answer to "is anyone viewing this chat?" for the idle history
//! release (`mainframe_chat::chat_viewers`): a facade session on it (the desktop
//! attaches only the chat on screen, a workspace tab or a task row; mobile
//! attaches what it shows), an event-socket subscription to it, or a blocking
//! orchestration wait on it.

use std::sync::Arc;

use std::collections::HashSet;
use std::sync::Mutex;

use mainframe_chat::chat_viewers::ChatViewers;
use mainframe_types::sync::LockExt as _;

use crate::FacadeHub;
use crate::acp_ws::facade_conn::FacadeConnection;
use crate::ctx::AppCtx;
use crate::websocket::WsClients;

pub(crate) struct DaemonChatViewers {
    hub: Arc<FacadeHub>,
    ws_clients: WsClients,
}

impl DaemonChatViewers {
    pub(crate) fn new(hub: Arc<FacadeHub>, ws_clients: WsClients) -> Self {
        Self { hub, ws_clients }
    }
}

impl ChatViewers for DaemonChatViewers {
    fn is_viewed(&self, chat_id: &str) -> bool {
        self.hub.is_viewing(chat_id)
            || self.ws_clients.iter().any(|client| {
                client
                    .value()
                    .subscriptions
                    .lock_recover()
                    .contains(chat_id)
            })
            || mainframe_orchestration::waiter::is_watched(chat_id)
    }
}

/// A client started or stopped showing a chat. The release's idle clock
/// counts it as use, so a view shorter than one scan still restarts the wait.
pub(crate) fn note_view(ctx: &AppCtx, chat_id: &str) {
    ctx.chat.chat_manager.note_viewing(chat_id);
}

pub(crate) fn subscribe(ctx: &AppCtx, subscriptions: &Mutex<HashSet<String>>, chat_id: &str) {
    subscriptions.lock_recover().insert(chat_id.to_owned());
    note_view(ctx, chat_id);
}

pub(crate) fn unsubscribe(ctx: &AppCtx, subscriptions: &Mutex<HashSet<String>>, chat_id: &str) {
    subscriptions.lock_recover().remove(chat_id);
    note_view(ctx, chat_id);
}

/// An event socket closed: it stops showing every chat it subscribed to.
pub(crate) fn forget_client(ctx: &AppCtx, client_id: &str) {
    let Some((_, handle)) = ctx.infra.ws_clients.remove(client_id) else {
        return;
    };
    let chats: Vec<String> = handle
        .subscriptions
        .lock_recover()
        .iter()
        .cloned()
        .collect();
    for chat_id in chats {
        note_view(ctx, &chat_id);
    }
}

/// A facade connection closed: it stops showing every chat it attached to.
pub(crate) fn close_facade(ctx: &AppCtx, client_id: &str, connection: &FacadeConnection) {
    let chats = connection.attached_chats();
    ctx.chat.facade_hub.unregister(client_id);
    for chat_id in chats {
        note_view(ctx, &chat_id);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::websocket::ClientHandle;

    fn viewers() -> (DaemonChatViewers, Arc<FacadeHub>, WsClients) {
        let hub = Arc::new(FacadeHub::new(0));
        let clients: WsClients = Arc::new(dashmap::DashMap::new());
        (
            DaemonChatViewers::new(hub.clone(), clients.clone()),
            hub,
            clients,
        )
    }

    #[test]
    fn a_facade_session_or_a_socket_subscription_views_a_chat() {
        let (viewers, hub, clients) = viewers();
        assert!(!viewers.is_viewed("viewers-chat"));

        let (_id, connection, _rx) = hub.register("mobile".to_string());
        hub.attach(&connection, "viewers-chat");
        assert!(viewers.is_viewed("viewers-chat"), "a facade session");
        connection.forget_chat("viewers-chat");
        assert!(!viewers.is_viewed("viewers-chat"));

        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        clients.insert(
            "client".to_string(),
            ClientHandle {
                tx,
                subscriptions: Arc::new(Mutex::new(HashSet::from(["viewers-chat".to_string()]))),
            },
        );
        assert!(viewers.is_viewed("viewers-chat"), "a socket subscription");
        assert!(!viewers.is_viewed("viewers-other"));
    }

    pub(crate) async fn chat_with_a_cell(ctx: &AppCtx) -> String {
        let project = ctx
            .core
            .db
            .call(|db| db.projects.create("/workspace", None))
            .await
            .unwrap();
        ctx.chat
            .chat_manager
            .create_chat(mainframe_types::chat::NewChat {
                project_id: project.id,
                adapter_id: "claude".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .id
    }

    /// A view that starts and ends between two scans still counts as use.
    #[tokio::test]
    async fn subscribing_detaching_and_closing_restart_the_idle_clock() {
        let ctx = AppCtx::test_ctx();
        let chat_id = chat_with_a_cell(&ctx).await;
        let manager = ctx.chat.chat_manager.clone();
        let restarts = |what: &str, act: &dyn Fn()| {
            manager.set_last_used_at_for_test(&chat_id, 1);
            act();
            assert!(
                manager.last_used_at(&chat_id).unwrap() > 1,
                "{what} restarts the idle clock"
            );
        };
        let subscriptions = Mutex::new(HashSet::new());

        restarts("a socket subscription", &|| {
            subscribe(&ctx, &subscriptions, &chat_id)
        });
        restarts("a socket unsubscription", &|| {
            unsubscribe(&ctx, &subscriptions, &chat_id);
        });
        restarts("a closed socket", &|| {
            let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
            ctx.infra.ws_clients.insert(
                "client".to_string(),
                ClientHandle {
                    tx,
                    subscriptions: Arc::new(Mutex::new(HashSet::from([chat_id.clone()]))),
                },
            );
            forget_client(&ctx, "client");
        });
        restarts("a closed facade connection", &|| {
            let (client_id, connection, _rx) = ctx.chat.facade_hub.register("claude".to_string());
            ctx.chat.facade_hub.attach(&connection, &chat_id);
            close_facade(&ctx, &client_id, &connection);
        });
        assert!(!ctx.chat.facade_hub.is_viewing(&chat_id));
    }
}
