use super::test_support::{Server, request};
use mainframe_types::adapter::{ControlBehavior, ControlRequest};
use serde_json::{Value, json};

/// Starts the chat's session with a first message, then raises `request`.
async fn raise(s: &Server, token: &str, request: ControlRequest) {
    let sent = s
        .call(token, "chat_send", json!({"chatId":s.chat,"text":"Go"}))
        .await;
    assert_eq!(sent["result"]["structuredContent"]["sent"], true);
    s.live().sink(&s.chat).on_permission(request);
}

async fn answer(s: &Server, token: &str, args: Value) -> Value {
    let mut args = args;
    args["chatId"] = json!(s.chat);
    s.call(token, "chat_answer", args).await["result"].clone()
}

#[tokio::test]
async fn an_approval_is_delivered_once_with_the_requests_own_input() {
    let s = Server::start_live().await;
    let token = s.answering_key("default").await;
    raise(
        &s,
        &token,
        request("req_1", "Bash", json!({"command":"ls"})),
    )
    .await;
    let seen = s.call(&token, "chat_wait", json!({"chatId":s.chat})).await;
    let prompt = &seen["result"]["structuredContent"]["pendingPrompt"];
    assert_eq!(prompt["answerable"], true);
    assert_eq!(prompt["canAllow"], true);
    let result = answer(&s, &token, json!({"requestId":"req_1","decision":"allow"})).await;
    assert_eq!(result["isError"], false);
    let answers = s.live().answers();
    assert_eq!(answers.len(), 1);
    assert_eq!(answers[0].request_id, "req_1");
    assert_eq!(answers[0].tool_use_id, "toolu_req_1");
    assert_eq!(answers[0].behavior, ControlBehavior::Allow);
    assert_eq!(
        answers[0].updated_input.as_ref().unwrap()["command"],
        json!("ls")
    );
    assert_eq!(answers[0].scope, None);
    assert!(answers[0].updated_permissions.is_none());
    assert_eq!(answers[0].execution_mode, None);

    let again = answer(&s, &token, json!({"requestId":"req_1","decision":"allow"})).await;
    assert_eq!(
        again["structuredContent"]["error"]["code"],
        "chat_not_sendable"
    );
    assert_eq!(s.live().answers().len(), 1);
}

#[tokio::test]
async fn a_denial_carries_the_users_reason_under_the_clients_name() {
    let s = Server::start_live().await;
    let token = s.answering_key("default").await;
    raise(
        &s,
        &token,
        request("req_1", "Bash", json!({"command":"rm -rf build"})),
    )
    .await;
    let mixed = answer(
        &s,
        &token,
        json!({"requestId":"req_1","decision":"allow","message":"sure"}),
    )
    .await;
    assert_eq!(mixed["isError"], true);
    let result = answer(
        &s,
        &token,
        json!({"requestId":"req_1","decision":"deny","message":"  Keep the build folder  "}),
    )
    .await;
    assert_eq!(result["isError"], false);
    let answers = s.live().answers();
    assert_eq!(answers.len(), 1);
    assert_eq!(answers[0].behavior, ControlBehavior::Deny);
    assert_eq!(
        answers[0].message.as_deref(),
        Some("From external client Voice test: Keep the build folder")
    );
    assert!(answers[0].updated_input.is_none());
}

#[tokio::test]
async fn answering_needs_the_grant_the_ceiling_and_the_current_request() {
    let s = Server::start_live().await;
    let plain = s.grant("control", "default").await;
    let plain = plain["token"].as_str().unwrap();
    let token = s.answering_key("default").await;
    raise(
        &s,
        &token,
        request("req_1", "Bash", json!({"command":"ls"})),
    )
    .await;

    let tools = s.rpc(plain, "tools/list", json!({})).await;
    assert!(!tools.to_string().contains("chat_answer"));
    let refused = s
        .call(
            plain,
            "chat_answer",
            json!({"chatId":s.chat,"requestId":"req_1","decision":"allow"}),
        )
        .await;
    assert_eq!(refused["error"]["code"], -32602);
    let seen = s.call(plain, "chat_wait", json!({"chatId":s.chat})).await;
    let prompt = &seen["result"]["structuredContent"]["pendingPrompt"];
    assert_eq!(prompt["requestId"], "req_1");
    assert_eq!(prompt["answerable"], false);

    let stale = answer(&s, &token, json!({"requestId":"req_0","decision":"allow"})).await;
    assert_eq!(
        stale["structuredContent"]["error"]["code"],
        "chat_not_sendable"
    );

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
    let above = answer(&s, &token, json!({"requestId":"req_1","decision":"allow"})).await;
    assert_eq!(
        above["structuredContent"]["error"]["code"],
        "permission_mode_escalation_denied"
    );
    assert!(s.live().answers().is_empty());
}

#[tokio::test]
async fn a_question_is_answered_per_question_and_nothing_else() {
    let s = Server::start_live().await;
    let token = s.answering_key("default").await;
    let questions = json!({"questions":[
        {"question":"Which database?","options":[{"label":"SQLite"},{"label":"Postgres"}]},
        {"question":"Which checks?","multiSelect":true,"options":[{"label":"Lint"},{"label":"Tests"}]}
    ]});
    raise(&s, &token, request("req_1", "AskUserQuestion", questions)).await;

    let seen = s.call(&token, "chat_wait", json!({"chatId":s.chat})).await;
    let prompt = &seen["result"]["structuredContent"]["pendingPrompt"];
    assert_eq!(prompt["kind"], "question");
    assert_eq!(
        prompt["questions"],
        json!([
            {"question":"Which database?","options":["SQLite","Postgres"],"multiSelect":false},
            {"question":"Which checks?","options":["Lint","Tests"],"multiSelect":true}
        ])
    );

    for answers in [
        Value::Null,
        json!({"Which database?":"SQLite"}),
        json!({"Which database?":["SQLite"],"Which checks?":["Lint"]}),
        json!({"Which database?":"SQLite","Which checks?":["Lint"],"Extra?":"x"}),
        json!({"Which database?":" ","Which checks?":["Lint"]}),
    ] {
        let mut args = json!({"requestId":"req_1","decision":"allow"});
        if !answers.is_null() {
            args["answers"] = answers;
        }
        assert_eq!(answer(&s, &token, args).await["isError"], true);
    }
    assert!(s.live().answers().is_empty());

    let chosen = json!({"Which database?":"SQLite","Which checks?":["Lint","Tests"]});
    let result = answer(
        &s,
        &token,
        json!({"requestId":"req_1","decision":"allow","answers":chosen}),
    )
    .await;
    assert_eq!(result["isError"], false);
    let answers = s.live().answers();
    let updated = answers[0].updated_input.as_ref().unwrap();
    assert_eq!(updated["answers"], chosen);
    assert!(updated["questions"].is_array());
}

#[tokio::test]
async fn approving_a_plan_keeps_the_chats_permission_mode() {
    let s = Server::start_live().await;
    let token = s.answering_key("yolo").await;
    raise(
        &s,
        &token,
        request("req_1", "ExitPlanMode", json!({"plan":"1. Do it"})),
    )
    .await;
    let seen = s.call(&token, "chat_wait", json!({"chatId":s.chat})).await;
    assert_eq!(
        seen["result"]["structuredContent"]["pendingPrompt"]["kind"],
        "plan"
    );
    let result = answer(&s, &token, json!({"requestId":"req_1","decision":"allow"})).await;
    assert_eq!(result["isError"], false);
    assert_eq!(
        s.live().answers()[0].execution_mode,
        Some(mainframe_types::settings::ExecutionMode::Default)
    );
    assert_eq!(
        s.ctx
            .chat
            .chat_manager
            .get_chat(&s.chat)
            .unwrap()
            .permission_mode,
        Some(mainframe_types::settings::ExecutionMode::Default)
    );
}

#[tokio::test]
async fn a_read_only_client_cannot_be_granted_prompt_answering() {
    let s = Server::start().await;
    assert_eq!(s.create_client("read", "default", true).await.status(), 400);
    let created = s.create_client("control", "default", true).await;
    let created = created.json::<Value>().await.unwrap();
    assert_eq!(created["data"]["client"]["answerPrompts"], true);
    let token = created["data"]["token"].as_str().unwrap();
    let tools = s.rpc(token, "tools/list", json!({})).await;
    assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 10);
}
