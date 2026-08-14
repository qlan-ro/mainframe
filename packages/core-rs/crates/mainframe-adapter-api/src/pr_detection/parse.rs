//! URL / JSON PR parsers — GitHub, GitLab and Azure DevOps.

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

/// `"pullRequestId"\s*:\s*(\d+)` + `"name"\s*:\s*"([^"]+)"` + `dev\.azure\.com/([^/"]+)`.
fn parse_azure_pr_json(text: &str) -> Option<DetectedPrCore> {
    let number = json_number_after(text, "\"pullRequestId\"")?;
    let repo = json_string_after(text, "\"name\"").unwrap_or_else(|| "unknown".to_string());
    let owner = azure_org(text).unwrap_or_else(|| "azure".to_string());
    Some(DetectedPrCore {
        url: text.trim().to_string(),
        owner,
        repo,
        number,
    })
}

fn json_number_after(text: &str, key: &str) -> Option<i64> {
    let idx = text.find(key)?;
    let rest = text[idx + key.len()..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    let (digits, _) = read_digits(rest)?;
    digits.parse().ok()
}

fn json_string_after(text: &str, key: &str) -> Option<String> {
    let idx = text.find(key)?;
    let rest = text[idx + key.len()..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    if end == 0 {
        return None;
    }
    Some(rest[..end].to_string())
}

fn azure_org(text: &str) -> Option<String> {
    let marker = "dev.azure.com/";
    let idx = text.find(marker)?;
    let rest = &text[idx + marker.len()..];
    let end = rest.find(['/', '"']).unwrap_or(rest.len());
    if end == 0 {
        return None;
    }
    Some(rest[..end].to_string())
}

/// `parsePrUrl ?? parseGitlabMrUrl ?? parseAzurePrUrl ?? parseAzurePrJson`.
pub fn extract_pr_from_tool_result(text: &str) -> Option<DetectedPrCore> {
    parse_pr_url(text)
        .or_else(|| parse_gitlab_mr_url(text))
        .or_else(|| parse_azure_pr_url(text))
        .or_else(|| parse_azure_pr_json(text))
}
