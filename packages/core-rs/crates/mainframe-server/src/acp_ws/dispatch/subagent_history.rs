use super::*;
use mainframe_types::acp::extensions::{
    SubagentHistoryPageParams, SubagentHistoryParams, SubagentHistorySearchParams,
};
use mainframe_types::display::DisplayMessage;

enum Operation {
    Page(SubagentHistoryPageParams),
    Search(String),
    Export,
}

fn operation(
    request: &JsonRpcRequest,
) -> Result<(SubagentHistoryParams, Operation), JsonRpcResponse> {
    match request.method.as_str() {
        "_mainframe.dev/subagent_history_page" => {
            let params: SubagentHistoryPageParams = parse(request)?;
            let target = SubagentHistoryParams {
                session_id: params.session_id.clone(),
                agent_id: params.agent_id.clone(),
            };
            Ok((target, Operation::Page(params)))
        }
        "_mainframe.dev/subagent_history_search" => {
            let params: SubagentHistorySearchParams = parse(request)?;
            Ok((params.target, Operation::Search(params.query)))
        }
        _ => Ok((parse(request)?, Operation::Export)),
    }
}

pub(super) async fn handle(request: JsonRpcRequest, ctx: &AppCtx, connection: &FacadeConnection) {
    let (target, op) = match operation(&request) {
        Ok(value) => value,
        Err(error) => {
            connection.send_json(&error);
            return;
        }
    };
    let messages = match ctx
        .chat
        .chat_manager
        .get_subagent_history(&target.session_id, target.agent_id)
        .await
    {
        Ok(messages) => messages,
        Err(_) => {
            connection.send_json(&rpc::error_response(
                request.id,
                rpc::invalid_params("Sub-agent transcript is unavailable"),
            ));
            return;
        }
    };
    let options = mainframe_acp::history_page::PageOptions {
        compressed: connection.is_compressed_replay_opted_in(),
        ..Default::default()
    };
    let result = tokio::task::spawn_blocking(move || render(&messages, op, options)).await;
    let reply = match result {
        Ok(value) => rpc::success_response(request.id, value),
        Err(err) => {
            error!(error = %err, chat_id = target.session_id, "sub-agent history worker failed");
            rpc::error_response(
                request.id,
                rpc::internal_error("Sub-agent history worker failed"),
            )
        }
    };
    connection.send_json(&reply);
}

fn render(
    messages: &[DisplayMessage],
    op: Operation,
    options: mainframe_acp::history_page::PageOptions,
) -> serde_json::Value {
    match op {
        Operation::Page(params) => serde_json::json!(mainframe_acp::history_page::subagent_page(
            messages, params, options
        )),
        Operation::Search(query) => {
            serde_json::json!(mainframe_acp::history_search::search(messages, &query))
        }
        Operation::Export => serde_json::json!({"markdown": export(messages)}),
    }
}

fn export(messages: &[DisplayMessage]) -> String {
    use mainframe_types::content::LeafContent;
    use mainframe_types::display::DisplayContent;
    messages
        .iter()
        .flat_map(|message| &message.content)
        .filter_map(|block| match block {
            DisplayContent::Leaf(LeafContent::Text { text, .. }) => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::content::LeafContent;
    use mainframe_types::display::{DisplayContent, DisplayMessageType};

    #[test]
    fn pages_and_search_and_export_use_child_content() {
        let messages: Vec<_> = (0..4)
            .map(|index| DisplayMessage {
                id: format!("child-{index}"),
                chat_id: "parent".into(),
                r#type: DisplayMessageType::Assistant,
                content: vec![DisplayContent::Leaf(LeafContent::Text {
                    text: format!("Child message {index}"),
                    parent_tool_use_id: None,
                })],
                timestamp: "2026-11-26T00:00:00Z".into(),
                metadata: None,
            })
            .collect();
        let mut params = SubagentHistoryPageParams {
            session_id: "parent".into(),
            agent_id: "tool-agent".into(),
            before: None,
            containers: Some(2),
            until_item_id: None,
        };
        let options = Default::default();
        let initial = render(&messages, Operation::Page(params.clone()), options);
        assert_eq!(initial["hasMore"], true);
        assert_eq!(initial["updates"].as_array().unwrap().len(), 2);
        params.before = Some(initial["floorItemId"].as_str().unwrap().into());
        let earlier = render(&messages, Operation::Page(params), options);
        assert_eq!(earlier["hasMore"], false);
        assert_eq!(earlier["updates"].as_array().unwrap().len(), 2);
        let search = render(&messages, Operation::Search("message 1".into()), options);
        assert_eq!(search["matches"][0]["containerId"], "child-1");
        let export = render(&messages, Operation::Export, options);
        assert_eq!(
            export["markdown"]
                .as_str()
                .unwrap()
                .lines()
                .filter(|line| !line.is_empty())
                .count(),
            4
        );
    }
}
