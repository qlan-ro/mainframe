use super::send_outgoing::Outgoing;
use super::*;
use mainframe_db::idle_compaction_queue::{QueuedCommand, QueuedImage, QueuedInput};
use mainframe_types::sync::LockExt as _;

impl ChatManager {
    pub(super) fn build_maintenance_input(
        &self,
        chat_id: &str,
        content: &str,
        attachment_ids: Option<&[String]>,
        command: Option<CommandMeta>,
        outgoing: Outgoing,
    ) -> QueuedInput {
        let uuid = nanoid::nanoid!();
        let metadata = metadata(&uuid, &outgoing.attachment_previews);
        let message = self
            .shared
            .messages
            .lock_recover()
            .create_transient_message_with_vendor_id(
                chat_id,
                ChatMessageType::User,
                outgoing.message_content,
                Some(metadata),
                Some(uuid.clone()),
            );
        QueuedInput {
            uuid,
            content: content.to_owned(),
            text_prefix: if content.is_empty() {
                outgoing.text.clone()
            } else {
                outgoing
                    .text
                    .strip_suffix(content)
                    .and_then(|p| p.strip_suffix("\n\n"))
                    .unwrap_or_default()
                    .to_owned()
            },
            prepared_text: outgoing.text,
            images: outgoing
                .images
                .into_iter()
                .map(|i| QueuedImage {
                    media_type: i.media_type,
                    data: i.data,
                    path: i.path,
                })
                .collect(),
            attachment_ids: attachment_ids.map(<[String]>::to_vec),
            message,
            command: command.map(|c| QueuedCommand {
                name: c.name,
                source: c.source,
                args: c.args,
            }),
        }
    }
}

fn metadata(uuid: &str, previews: &[serde_json::Value]) -> HashMap<String, serde_json::Value> {
    let mut metadata = HashMap::from([
        ("queued".to_owned(), serde_json::json!(true)),
        ("uuid".to_owned(), serde_json::json!(uuid)),
    ]);
    if !previews.is_empty() {
        metadata.insert("attachments".to_owned(), serde_json::json!(previews));
    }
    metadata
}

pub(super) async fn dispatch(
    session: &Arc<dyn AdapterSession>,
    input: &QueuedInput,
    images: Vec<ImageInput>,
) -> Result<(), AdapterError> {
    match &input.command {
        Some(cmd) if cmd.source != "mainframe" => {
            session
                .send_command(cmd.name.clone(), cmd.args.clone())
                .await
        }
        Some(cmd) => {
            let args = cmd
                .args
                .clone()
                .or_else(|| find_mainframe_command(&cmd.name).and_then(|c| c.prompt_template));
            session
                .send_message(
                    wrap_mainframe_command(&cmd.name, &input.content, args.as_deref()),
                    images,
                    Some(input.uuid.clone()),
                )
                .await
        }
        None => {
            session
                .send_message(
                    input.prepared_text.clone(),
                    images,
                    Some(input.uuid.clone()),
                )
                .await
        }
    }
}
