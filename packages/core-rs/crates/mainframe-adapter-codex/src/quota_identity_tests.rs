use super::*;

fn account_ok(account: Option<Account>) -> Box<ReadAccount> {
    Box::new(move || {
        let account = account.clone();
        Box::pin(async move { Ok(account) })
    })
}
fn account_err() -> Box<ReadAccount> {
    Box::new(|| Box::pin(async { Err(AdapterError::Message("app-server unreachable".into())) }))
}
fn auth_file_ok(account_id: Option<&'static str>) -> Box<ReadAuthFile> {
    Box::new(move || {
        Box::pin(async move {
            Ok(Some(CodexAuthFile {
                tokens: Some(AuthTokens {
                    account_id: account_id.map(str::to_string),
                }),
            }))
        })
    })
}
fn auth_file_none() -> Box<ReadAuthFile> {
    Box::new(|| Box::pin(async { Ok(None) }))
}
fn auth_file_err() -> Box<ReadAuthFile> {
    Box::new(|| Box::pin(async { Err(AdapterError::Message("EACCES".into())) }))
}

#[tokio::test]
async fn returns_the_account_read_email_for_a_chatgpt_account() {
    let read_account = account_ok(Some(Account::Chatgpt {
        email: Some("a@b.com".into()),
        plan_type: Some("plus".into()),
    }));
    let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
        read_account: &read_account,
        read_auth_file: None,
    })
    .await;
    assert_eq!(identity, "a@b.com");
}

#[tokio::test]
async fn falls_back_to_auth_json_account_id_when_the_chatgpt_account_has_no_email() {
    let read_account = account_ok(Some(Account::Chatgpt {
        email: None,
        plan_type: Some("plus".into()),
    }));
    let read_auth_file = auth_file_ok(Some("uuid-456"));
    let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
        read_account: &read_account,
        read_auth_file: Some(&read_auth_file),
    })
    .await;
    assert_eq!(identity, "uuid-456");
}

#[tokio::test]
async fn returns_a_synthetic_api_key_bucket_when_there_is_no_email_and_no_auth_json_fallback() {
    let read_account = account_ok(Some(Account::ApiKey));
    let read_auth_file = auth_file_none();
    let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
        read_account: &read_account,
        read_auth_file: Some(&read_auth_file),
    })
    .await;
    assert_eq!(identity, "apiKey");
}

#[tokio::test]
async fn returns_a_synthetic_bedrock_bucket_for_amazon_bedrock_accounts() {
    let read_account = account_ok(Some(Account::AmazonBedrock {
        credential_source: Some("env".into()),
    }));
    let read_auth_file = auth_file_none();
    let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
        read_account: &read_account,
        read_auth_file: Some(&read_auth_file),
    })
    .await;
    assert_eq!(identity, "bedrock");
}

#[tokio::test]
async fn returns_the_unknown_bucket_when_there_is_no_account_at_all() {
    let read_account = account_ok(None);
    let read_auth_file = auth_file_none();
    let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
        read_account: &read_account,
        read_auth_file: Some(&read_auth_file),
    })
    .await;
    assert_eq!(identity, CODEX_IDENTITY_UNKNOWN);
}

#[tokio::test]
async fn returns_the_transient_sentinel_when_account_read_fails() {
    let read_account = account_err();
    let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
        read_account: &read_account,
        read_auth_file: None,
    })
    .await;
    assert_eq!(identity, CODEX_IDENTITY_TRANSIENT);
}

#[tokio::test]
async fn returns_the_transient_sentinel_when_auth_json_is_present_but_unreadable() {
    let read_account = account_ok(Some(Account::ApiKey));
    let read_auth_file = auth_file_err();
    let identity = read_codex_account_identity(ReadCodexAccountIdentityDeps {
        read_account: &read_account,
        read_auth_file: Some(&read_auth_file),
    })
    .await;
    assert_eq!(identity, CODEX_IDENTITY_TRANSIENT);
}
