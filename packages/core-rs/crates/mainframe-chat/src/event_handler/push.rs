/// A fire-and-forget push notification (`pushService.sendPush`).
#[derive(Debug, Clone, PartialEq)]
pub struct PushOut {
    pub chat_id: String,
    pub title: String,
    pub body: String,
    pub push_type: String,
    pub priority: String,
}
