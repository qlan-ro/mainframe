//! `ClientEvent`: the client→server half of the daemon WebSocket contract, tagged
//! and camelCased the same way as `DaemonEvent` (see the parent module).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ClientEvent {
    #[serde(rename = "subscribe")]
    Subscribe { chat_id: String },
    #[serde(rename = "unsubscribe")]
    Unsubscribe { chat_id: String },
    #[serde(rename = "subscribe:file")]
    SubscribeFile {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        chat_id: Option<String>,
    },
    #[serde(rename = "unsubscribe:file")]
    UnsubscribeFile {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        chat_id: Option<String>,
    },
}
