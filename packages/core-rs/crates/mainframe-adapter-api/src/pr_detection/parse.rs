//! URL / JSON PR parsers — GitHub, GitLab and Azure DevOps.

use serde_json::Value;

use super::DetectedPrCore;
use super::text::{read_digits, read_segment, scan_prefix};

fn try_github(rest: &str) -> Option<DetectedPrCore> {
    let prefix = "https://github.com/";
    let (owner, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let (repo, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let rest = rest.strip_prefix("pull")?;
    let rest = rest.strip_prefix('/')?;
    let (digits, _) = read_digits(rest)?;
    Some(DetectedPrCore {
        url: format!("{prefix}{owner}/{repo}/pull/{digits}"),
        owner: owner.to_string(),
        repo: repo.to_string(),
        number: digits.parse().ok()?,
    })
}

/// `https://github.com/([^/\s]+)/([^/\s]+)/pull/(\d+)`
pub fn parse_pr_url(text: &str) -> Option<DetectedPrCore> {
    scan_prefix(text, "https://github.com/", try_github)
}

fn try_gitlab(rest: &str) -> Option<DetectedPrCore> {
    let prefix = "https://gitlab.com/";
    let (owner, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let (repo, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let rest = rest.strip_prefix('-')?;
    let rest = rest.strip_prefix('/')?;
    let rest = rest.strip_prefix("merge_requests")?;
    let rest = rest.strip_prefix('/')?;
    let (digits, _) = read_digits(rest)?;
    Some(DetectedPrCore {
        url: format!("{prefix}{owner}/{repo}/-/merge_requests/{digits}"),
        owner: owner.to_string(),
        repo: repo.to_string(),
        number: digits.parse().ok()?,
    })
}

/// `https://gitlab.com/([^/\s]+)/([^/\s]+)/-/merge_requests/(\d+)`
pub fn parse_gitlab_mr_url(text: &str) -> Option<DetectedPrCore> {
    scan_prefix(text, "https://gitlab.com/", try_gitlab)
}

fn try_azure(rest: &str) -> Option<DetectedPrCore> {
    let prefix = "https://dev.azure.com/";
    let (owner, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let (project, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let rest = rest.strip_prefix("_git")?;
    let rest = rest.strip_prefix('/')?;
    let (repo, rest) = read_segment(rest)?;
    let rest = rest.strip_prefix('/')?;
    let rest = rest.strip_prefix("pullrequest")?;
    let rest = rest.strip_prefix('/')?;
    let (digits, _) = read_digits(rest)?;
    Some(DetectedPrCore {
        url: format!("{prefix}{owner}/{project}/_git/{repo}/pullrequest/{digits}"),
        owner: owner.to_string(),
        repo: repo.to_string(),
        number: digits.parse().ok()?,
    })
}

/// `https://dev.azure.com/([^/\s]+)/[^/\s]+/_git/([^/\s]+)/pullrequest/(\d+)`
pub fn parse_azure_pr_url(text: &str) -> Option<DetectedPrCore> {
    scan_prefix(text, "https://dev.azure.com/", try_azure)
}

/// The JSON `az repos pr create` and `az repos pr show` print: `pullRequestId`
/// plus the `repository` it belongs to. `az` prints `repository.webUrl` as
/// `null`, so the browser URL is normally rebuilt from the organization in the
/// API `url` and the repository's project and name.
fn parse_azure_pr_json(text: &str) -> Option<DetectedPrCore> {
    // Cheap gate: most tool results are not PR JSON, and history scans run
    // every result through here.
    if !text.contains("\"pullRequestId\"") {
        return None;
    }
    let pr = first_json_object(text)?;
    let number = pr.get("pullRequestId")?.as_i64()?;
    let repository = pr.get("repository")?;
    let repo = repository.get("name")?.as_str()?;
    let web_url = match repository.get("webUrl").and_then(Value::as_str) {
        Some(web_url) => web_url.trim_end_matches('/').to_string(),
        None => {
            let org = azure_org(pr.get("url")?.as_str()?)?;
            let project = repository.get("project")?.get("name")?.as_str()?;
            format!(
                "https://dev.azure.com/{org}/{}/_git/{}",
                encode_path_segment(project),
                encode_path_segment(repo)
            )
        }
    };
    Some(DetectedPrCore {
        url: format!("{web_url}/pullrequest/{number}"),
        owner: azure_org(&web_url)?.to_string(),
        repo: repo.to_string(),
        number,
    })
}

/// The first JSON object in `text`, ignoring whatever the CLI printed before
/// or after it. For a list (`az repos pr list`) that is the first item.
fn first_json_object(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    serde_json::Deserializer::from_str(&text[start..])
        .into_iter::<Value>()
        .next()?
        .ok()
}

/// `segment` percent-encoded for a URL path, as a browser shows Azure DevOps
/// project and repository names (`Contoso Web` → `Contoso%20Web`).
fn encode_path_segment(segment: &str) -> String {
    let mut encoded = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// The organization in `https://dev.azure.com/{org}/…` or
/// `https://{org}.visualstudio.com/…`.
fn azure_org(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("https://")?;
    let org = match rest.strip_prefix("dev.azure.com/") {
        Some(path) => path.split('/').next()?,
        None => rest.split_once(".visualstudio.com")?.0,
    };
    (!org.is_empty() && !org.contains(['/', '@'])).then_some(org)
}

/// The first PR a tool result names: a GitHub, GitLab or Azure DevOps URL, then
/// Azure CLI JSON.
pub fn extract_pr_from_tool_result(text: &str) -> Option<DetectedPrCore> {
    parse_pr_url(text)
        .or_else(|| parse_gitlab_mr_url(text))
        .or_else(|| parse_azure_pr_url(text))
        .or_else(|| parse_azure_pr_json(text))
}
