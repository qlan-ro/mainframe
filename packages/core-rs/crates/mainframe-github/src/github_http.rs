//! Shared GitHub REST conventions (base URL, API version, standard headers).
//! Auth stays out of this module — callers attach it, so this file has no
//! dependency on the credential store and stays reusable by the issues client.

use reqwest::RequestBuilder;

pub const GITHUB_API: &str = "https://api.github.com";
pub const API_VERSION: &str = "2022-11-28";

pub fn github_headers(request: RequestBuilder) -> RequestBuilder {
    request
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
}
