//! GitHub REST conventions shared by every client: base URL, API version,
//! standard headers and the per-request deadline. Callers attach auth.

use std::time::Duration;

use reqwest::RequestBuilder;

use crate::USER_AGENT;

pub const GITHUB_API: &str = "https://api.github.com";
pub const API_VERSION: &str = "2022-11-28";

/// Deadline for one GitHub request. reqwest has none by default, so a stalled
/// connection would hold its caller forever: a todos sync run, which is
/// exclusive per project, an automation step, or a device-flow route.
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// How much of a failed response body an error message quotes.
const ERROR_BODY_SNIPPET_CHARS: usize = 500;

/// Adds GitHub's standard headers and `REQUEST_TIMEOUT` to a REST request.
pub fn github_request(request: RequestBuilder) -> RequestBuilder {
    request
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
        .timeout(REQUEST_TIMEOUT)
}

/// Client builder with the user agent GitHub requires.
pub(crate) fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().user_agent(USER_AGENT)
}

pub(crate) fn snippet(body: &str) -> String {
    body.chars().take(ERROR_BODY_SNIPPET_CHARS).collect()
}
