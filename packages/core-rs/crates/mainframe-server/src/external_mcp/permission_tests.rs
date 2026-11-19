use super::test_support::Server;
use serde_json::json;

#[tokio::test]
async fn read_only_clients_cannot_invoke_control_tools_even_when_named_directly() {
    let s = Server::start().await;
    let grant = s.grant("read", "default").await;
    let token = grant["token"].as_str().unwrap();
    let list = s.rpc(token, "tools/list", json!({})).await;
    assert_eq!(list["result"]["tools"].as_array().unwrap().len(), 4);
    for tool in [
        "chat_launch",
        "chat_send",
        "chat_interrupt",
        "chat_configure",
    ] {
        let result = s
            .call(
                token,
                tool,
                json!({"chatId":s.chat,"permissionMode":"yolo"}),
            )
            .await;
        assert_eq!(result["error"]["code"], -32602);
    }
}

#[tokio::test]
async fn project_scope_hides_other_projects_and_chats() {
    let s = Server::start().await;
    let grant = s.grant("control", "yolo").await;
    let token = grant["token"].as_str().unwrap();
    let projects = s.call(token, "project_list", json!({})).await;
    let projects = projects["result"]["structuredContent"]["projects"]
        .as_array()
        .unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0]["id"], s.project);
    let list = s
        .call(token, "chat_list", json!({"projectId":s.other_project}))
        .await;
    assert_eq!(
        list["result"]["structuredContent"]["error"]["code"],
        "project_not_found"
    );
    for tool in ["chat_read", "chat_interrupt", "chat_configure"] {
        let result = s.call(token, tool, json!({"chatId":s.other_chat})).await;
        assert_eq!(
            result["result"]["structuredContent"]["error"]["code"],
            "chat_not_found"
        );
    }
    let result = s
        .call(
            token,
            "chat_send",
            json!({"chatId":s.other_chat,"text":"Hello"}),
        )
        .await;
    assert_eq!(result["result"]["isError"], true);
}

#[tokio::test]
async fn permission_ceiling_blocks_launch_configuration_and_sending_to_stronger_chats() {
    let s = Server::start().await;
    let grant = s.grant("control", "default").await;
    let token = grant["token"].as_str().unwrap();
    let result = s.call(token,"chat_launch",json!({"projectId":s.project,"adapterId":"claude","permissionMode":"yolo","prompt":"Hi"})).await;
    assert_eq!(
        result["result"]["structuredContent"]["error"]["code"],
        "permission_mode_escalation_denied"
    );
    let result = s
        .call(
            token,
            "chat_configure",
            json!({"chatId":s.chat,"permissionMode":"yolo"}),
        )
        .await;
    assert_eq!(result["result"]["isError"], true);
    s.ctx
        .chat
        .chat_manager
        .update_chat_config(
            &s.chat,
            None,
            None,
            Some(mainframe_types::settings::ExecutionMode::Yolo),
            None,
        )
        .await
        .unwrap();
    let result = s
        .call(token, "chat_send", json!({"chatId":s.chat,"text":"Hi"}))
        .await;
    assert_eq!(
        result["result"]["structuredContent"]["error"]["code"],
        "permission_mode_escalation_denied"
    );
}

#[tokio::test]
async fn control_client_configures_idle_chat_and_reports_a_failed_initial_send() {
    let s = Server::start().await;
    let grant = s.grant("control", "yolo").await;
    let token = grant["token"].as_str().unwrap();
    let result = s
        .call(
            token,
            "chat_configure",
            json!({"chatId":s.chat,"permissionMode":"acceptEdits"}),
        )
        .await;
    assert_eq!(result["result"]["isError"], false);
    assert_eq!(
        result["result"]["structuredContent"]["permissionMode"],
        "acceptEdits"
    );
    let result = s
        .call(
            token,
            "chat_launch",
            json!({"projectId":s.project,"adapterId":"claude","prompt":"Hi"}),
        )
        .await;
    assert_eq!(result["result"]["isError"], false);
    assert_eq!(result["result"]["structuredContent"]["sent"], false);
    assert!(result["result"]["structuredContent"]["error"].is_string());
    let id = result["result"]["structuredContent"]["chatId"]
        .as_str()
        .unwrap();
    assert_eq!(
        s.ctx
            .chat
            .chat_manager
            .get_chat(id)
            .unwrap()
            .permission_mode,
        Some(mainframe_types::settings::ExecutionMode::Default)
    );
    let read = s.call(token, "chat_read", json!({"chatId":id})).await;
    assert_eq!(read["result"]["isError"], false);
    let stop = s.call(token, "chat_interrupt", json!({"chatId":id})).await;
    assert_eq!(stop["result"]["structuredContent"]["interrupted"], true);
}
