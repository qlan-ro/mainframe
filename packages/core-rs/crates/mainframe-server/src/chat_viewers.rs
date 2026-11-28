//! The daemon's answer to "is anyone viewing this chat?" for the idle history
//! release (`mainframe_chat::chat_viewers`): a facade session on it (the desktop
//! attaches only the chat on screen, a workspace tab or a task row; mobile
//! attaches what it shows), an event-socket subscription to it, or a blocking
//! orchestration wait on it.

use std::sync::Arc;

use mainframe_chat::chat_viewers::ChatViewers;
use mainframe_types::sync::LockExt as _;

use crate::FacadeHub;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::websocket::ClientHandle;
    use std::collections::HashSet;
    use std::sync::Mutex;

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
}
