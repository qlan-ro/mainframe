//! Shared HTTP plumbing for the actions that call out: one client policy, one
//! connector request/response path, one error-body rendering.

use serde::de::DeserializeOwned;

use super::{ActionCtx, ActionError};

/// How much of a failed response body an error message quotes.
const ERROR_BODY_SNIPPET_CHARS: usize = 500;

/// The client every action that calls out uses: the runtime's defaults plus
/// this crate's `User-Agent`. A build failure is kept and surfaces as the
/// first request's error instead of silently falling back to a bare client.
pub(crate) fn client() -> Result<reqwest::Client, reqwest::Error> {
    mainframe_runtime::http::builder()
        .user_agent(crate::USER_AGENT)
        .build()
}

/// The first `ERROR_BODY_SNIPPET_CHARS` characters of a failed response body.
pub(crate) fn body_snippet(body: &str) -> String {
    body.chars().take(ERROR_BODY_SNIPPET_CHARS).collect()
}

/// Connector HTTP failure (`<op> failed (<status>): <500-char body>`); an
/// auth rejection also names the credential label the step used so the
/// failure is actionable from the run timeline.
pub(crate) fn http_failure(op: &str, status: u16, ctx: &ActionCtx, body: &str) -> ActionError {
    let snippet = body_snippet(body);
    if status == 401 || status == 403 {
        let cred = match &ctx.credential_label {
            Some(label) => format!("credential '{label}'"),
            None => "no credential configured".to_string(),
        };
        return ActionError(format!("{op} failed ({status}, {cred}): {snippet}"));
    }
    ActionError(format!("{op} failed ({status}): {snippet}"))
}

/// Sends a connector request and decodes its JSON body. Transport and body
/// read errors read `<operation> failed: <error>`; `special_error` may claim a
/// status before the generic `http_failure` (GitHub's not-installed 404);
/// any other status ≥ 400 becomes `http_failure`.
pub(crate) async fn send_json<T: DeserializeOwned>(
    request: reqwest::RequestBuilder,
    operation: &str,
    ctx: &ActionCtx,
    special_error: impl Fn(u16) -> Option<ActionError>,
) -> Result<T, ActionError> {
    let response = request
        .send()
        .await
        .map_err(|err| ActionError(format!("{operation} failed: {err}")))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|err| ActionError(format!("{operation} failed: {err}")))?;
    if let Some(error) = special_error(status) {
        return Err(error);
    }
    if status >= 400 {
        return Err(http_failure(operation, status, ctx, &body));
    }
    serde_json::from_str(&body)
        .map_err(|err| ActionError(format!("{operation} failed: unexpected response ({err})")))
}
