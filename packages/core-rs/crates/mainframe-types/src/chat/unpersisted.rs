use super::{Chat, NO_PROJECT_ID, NewChat};

impl Chat {
    pub fn unpersisted(new_chat: &NewChat) -> Self {
        let now = crate::time::now_iso8601();
        Self {
            id: nanoid::nanoid!(),
            adapter_id: new_chat.adapter_id.clone(),
            project_id: new_chat.project_id.clone(),
            no_project: new_chat.project_id == NO_PROJECT_ID,
            permission_mode: new_chat
                .permission_mode
                .as_deref()
                .filter(|mode| !mode.is_empty())
                .and_then(|mode| {
                    serde_json::from_value(serde_json::Value::String(mode.into())).ok()
                }),
            plan_mode: Some(false),
            created_at: now.clone(),
            updated_at: now,
            automation_run_id: new_chat.automation_run_id.clone(),
            temporary: new_chat.temporary,
            ..Self::default()
        }
    }
}
