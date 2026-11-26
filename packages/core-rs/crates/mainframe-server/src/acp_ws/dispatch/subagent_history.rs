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
        .get_subagent_history(&target.session_id, target.agent_id.clone())
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
    if matches!(op, Operation::Export) {
        let mut ancestors = vec![target.agent_id];
        let markdown = export(&messages, &mut ancestors, &|id| {
            ctx.chat
                .chat_manager
                .get_subagent_history(&target.session_id, id)
        })
        .await;
        connection.send_json(&rpc::success_response(
            request.id,
            serde_json::json!({"markdown": markdown}),
        ));
        return;
    }
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
        Operation::Export => unreachable!("export is handled before rendering"),
    }
}

enum Section<'a> {
    Text(&'a str),
    Agent(&'a str),
}

fn sections<'a>(
    blocks: &'a [mainframe_types::display::DisplayContent],
    facts: Option<&serde_json::Value>,
    output: &mut Vec<Section<'a>>,
) {
    use mainframe_types::content::LeafContent;
    use mainframe_types::display::{DisplayContent, DisplayNode};
    for block in blocks {
        match block {
            DisplayContent::Leaf(LeafContent::Text { text, .. }) => {
                output.push(Section::Text(text))
            }
            DisplayContent::Node(DisplayNode::ToolCall { id, .. })
                if facts.and_then(|facts| facts.get(id)).is_some() =>
            {
                output.push(Section::Agent(id));
            }
            DisplayContent::Node(DisplayNode::TaskGroup { agent_id, .. })
                if facts.and_then(|facts| facts.get(agent_id)).is_some() =>
            {
                output.push(Section::Agent(agent_id));
            }
            DisplayContent::Node(
                DisplayNode::ToolGroup { calls } | DisplayNode::TaskGroup { calls, .. },
            ) => {
                sections(calls, facts, output);
            }
            _ => {}
        }
    }
}

fn export<
    'a,
    E: Send,
    F: std::future::Future<Output = Result<Vec<DisplayMessage>, E>> + Send + 'a,
>(
    messages: &'a [DisplayMessage],
    ancestors: &'a mut Vec<String>,
    load: &'a (impl Fn(String) -> F + Sync),
) -> std::pin::Pin<Box<dyn std::future::Future<Output = String> + Send + 'a>> {
    Box::pin(async move {
        let mut ordered = Vec::new();
        for message in messages {
            let facts = message
                .metadata
                .as_ref()
                .and_then(|meta| meta.get("subagentFacts"));
            sections(&message.content, facts, &mut ordered);
        }
        let mut output = Vec::new();
        for section in ordered {
            match section {
                Section::Text(text) if !text.is_empty() => output.push(text.to_owned()),
                Section::Text(_) => {}
                Section::Agent(id) => {
                    let mut text = String::new();
                    if ancestors.len() < 64
                        && !ancestors.iter().any(|ancestor| ancestor == id)
                        && let Ok(child) = load(id.to_owned()).await
                    {
                        ancestors.push(id.to_owned());
                        text = export(&child, ancestors, load).await;
                        ancestors.pop();
                    }
                    output.push(if text.is_empty() {
                        "Sub-agent transcript unavailable".to_owned()
                    } else {
                        text
                    });
                }
            }
        }
        output.join("\n\n")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::content::LeafContent;
    use mainframe_types::display::{DisplayContent, DisplayMessageType};

    #[tokio::test]
    async fn pages_and_search_and_export_use_child_content() {
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
        let mut ancestors = vec![];
        let markdown = export(&messages, &mut ancestors, &|_| async {
            Err::<Vec<DisplayMessage>, _>(())
        })
        .await;
        assert_eq!(markdown.lines().filter(|line| !line.is_empty()).count(), 4);
    }
    #[tokio::test]
    async fn export_includes_nested_saved_transcripts_and_notes_missing_children() {
        use mainframe_types::display::DisplayNode;
        let child = |id: &str, content, metadata| DisplayMessage {
            id: id.into(),
            chat_id: "parent".into(),
            r#type: DisplayMessageType::Assistant,
            content,
            timestamp: "2026-11-26T00:00:00Z".into(),
            metadata,
        };
        let text = |text: &str| {
            DisplayContent::Leaf(LeafContent::Text {
                text: text.into(),
                parent_tool_use_id: None,
            })
        };
        let agent = |id: &str| {
            DisplayContent::Node(DisplayNode::TaskGroup {
                timing: None,
                agent_id: id.into(),
                task_args: Default::default(),
                calls: vec![],
                result: None,
            })
        };
        let root = child("root", vec![text("Before"), agent("nested"), agent("missing"), text("After")],
            Some([("subagentFacts".into(), serde_json::json!({"nested": {"status":"completed"}, "missing": {"status":"unknown"}}))].into()));
        let lookup = |id| {
            let nested = child("inner", vec![text("Nested answer")], None);
            async move {
                if id == "nested" {
                    Ok(vec![nested])
                } else {
                    Err(())
                }
            }
        };
        let markdown = export(&[root], &mut vec!["outer".into()], &lookup).await;
        assert_eq!(
            markdown,
            "Before\n\nNested answer\n\nSub-agent transcript unavailable\n\nAfter"
        );
    }
}
