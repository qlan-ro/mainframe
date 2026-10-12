use super::*;

pub trait EventEmitter: Send + Sync {
    fn emit_event(&self, event: DaemonEvent);

    fn tracker_remove_chat(&self, chat_id: &str);

    fn tracker_list_live(&self, chat_id: &str) -> Vec<BackgroundTask>;

    fn tracker_end_all_running(&self, chat_id: &str);

    fn workflow_runs_stop_all(&self, chat_id: &str);
}
