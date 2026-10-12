use super::*;
use crate::context_tracker::ContextDb;

impl ContextDb for Db {
    fn add_mention(&self, chat_id: &str, mention: &SessionMention) -> Result<bool, SeamError> {
        let (id, mention) = (chat_id.to_string(), mention.clone());
        self.call_blocking(move |d| d.chats.add_mention(&id, &mention))
            .map_err(store_error)
    }
    fn get_mentions(&self, chat_id: &str) -> Result<Vec<SessionMention>, SeamError> {
        let id = chat_id.to_string();
        self.call_blocking(move |d| d.chats.get_mentions(&id))
            .map_err(store_error)
    }
    fn get_plan_files(&self, chat_id: &str) -> Result<Vec<String>, SeamError> {
        let id = chat_id.to_string();
        self.call_blocking(move |d| d.chats.get_plan_files(&id))
            .map_err(store_error)
    }
    fn get_skill_files(&self, chat_id: &str) -> Result<Vec<SkillFileEntry>, SeamError> {
        let id = chat_id.to_string();
        self.call_blocking(move |d| d.chats.get_skill_files(&id))
            .map_err(store_error)
    }
}
