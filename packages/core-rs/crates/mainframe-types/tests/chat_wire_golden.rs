#![allow(clippy::unwrap_used, clippy::expect_used)]

//! Byte-level pin of the serialized `Chat`. The expected string was captured
//! from the pre-refactor struct; serde emits keys in declaration order
//! (flattened structs inline at their field's position), so a moved field
//! changes these bytes even when the JSON value is unchanged.

use mainframe_types::chat::Chat;

/// Every wire key set, including the flattened tuning and orchestration keys.
const FULL_CHAT_INPUT: &str = r#"{
        "id": "chat_golden",
        "adapterId": "claude",
        "projectId": "proj_golden",
        "title": "Golden chat",
        "claudeSessionId": "sess_1",
        "sessionFilePath": "/tmp/sess_1.jsonl",
        "model": "opus",
        "permissionMode": "acceptEdits",
        "planMode": true,
        "status": "active",
        "createdAt": "2026-10-01T10:00:00.000Z",
        "updatedAt": "2026-10-01T11:00:00.000Z",
        "totalCost": 1.25,
        "totalTokensInput": 100,
        "totalTokensOutput": 200,
        "lastContextTokensInput": 300,
        "lastContextTotalTokens": 400,
        "lastContextMaxTokens": 500,
        "contextFiles": ["src/a.rs"],
        "mentions": [{"id": "m1", "kind": "file", "source": "user", "name": "a.rs", "path": "src/a.rs", "timestamp": "2026-10-01T10:30:00.000Z"}],
        "modifiedFiles": ["src/b.rs"],
        "worktreePath": "/tmp/wt",
        "branchName": "feat/golden",
        "processState": "working",
        "displayStatus": "working",
        "isRunning": true,
        "backgroundActivity": {"total": 1, "byKind": {"bash": 1}, "tasks": [{"id": "bg1", "kind": "bash", "description": "ls", "startedAt": 1}]},
        "worktreeMissing": false,
        "directoryMissing": true,
        "missingDirectoryPath": "/tmp/gone",
        "transcriptMissing": false,
        "todos": [{"content": "Ship", "status": "in_progress", "activeForm": "Shipping"}],
        "pinned": true,
        "effort": "high",
        "fast": true,
        "ultracode": false,
        "adaptiveThinking": true,
        "detectedPrs": [{"url": "https://github.com/o/r/pull/1", "owner": "o", "repo": "r", "number": 1, "source": "created"}],
        "tags": ["bug"],
        "automationRunId": "run_1",
        "temporary": true,
        "noProject": false,
        "contextLostAt": "2026-10-01T10:45:00.000Z",
        "parentChatId": "chat_parent",
        "sideChatId": "chat_side",
        "sideChatWaiting": true,
        "createdByChatId": "chat_creator",
        "delegation": {"taskId": "task_1", "role": "review", "status": "running"},
        "delegatedWaiting": true,
        "agentOutbox": [{"entryId": "e1", "fromChatId": "chat_creator", "preview": "hi"}]
}"#;

#[test]
fn fully_populated_chat_serializes_keys_in_the_historical_order() {
    let chat: Chat = serde_json::from_str(FULL_CHAT_INPUT).unwrap();
    assert_eq!(serde_json::to_string(&chat).unwrap(), EXPECTED);
}

const EXPECTED: &str = r#"{"id":"chat_golden","adapterId":"claude","projectId":"proj_golden","title":"Golden chat","claudeSessionId":"sess_1","sessionFilePath":"/tmp/sess_1.jsonl","model":"opus","permissionMode":"acceptEdits","planMode":true,"status":"active","createdAt":"2026-10-01T10:00:00.000Z","updatedAt":"2026-10-01T11:00:00.000Z","totalCost":1.25,"totalTokensInput":100,"totalTokensOutput":200,"lastContextTokensInput":300,"lastContextTotalTokens":400,"lastContextMaxTokens":500,"contextFiles":["src/a.rs"],"mentions":[{"id":"m1","kind":"file","source":"user","name":"a.rs","path":"src/a.rs","timestamp":"2026-10-01T10:30:00.000Z"}],"modifiedFiles":["src/b.rs"],"worktreePath":"/tmp/wt","branchName":"feat/golden","processState":"working","displayStatus":"working","isRunning":true,"backgroundActivity":{"total":1,"byKind":{"bash":1},"tasks":[{"id":"bg1","kind":"bash","description":"ls","startedAt":1}]},"worktreeMissing":false,"directoryMissing":true,"missingDirectoryPath":"/tmp/gone","transcriptMissing":false,"todos":[{"content":"Ship","status":"in_progress","activeForm":"Shipping"}],"pinned":true,"effort":"high","fast":true,"ultracode":false,"adaptiveThinking":true,"detectedPrs":[{"url":"https://github.com/o/r/pull/1","owner":"o","repo":"r","number":1,"source":"created"}],"tags":["bug"],"automationRunId":"run_1","temporary":true,"noProject":false,"contextLostAt":"2026-10-01T10:45:00.000Z","parentChatId":"chat_parent","sideChatId":"chat_side","sideChatWaiting":true,"createdByChatId":"chat_creator","delegation":{"taskId":"task_1","role":"review","status":"running"},"delegatedWaiting":true,"agentOutbox":[{"entryId":"e1","fromChatId":"chat_creator","preview":"hi"}]}"#;
