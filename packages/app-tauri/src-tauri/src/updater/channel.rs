//! Update-channel resolution — Plan: update-channel-setting design doc
//! (docs/architecture/2026-07-13-update-channel-setting-design.md).
//!
//! Reads the daemon's `updateChannel` general setting and, for the
//! prerelease channel, resolves the newest published GitHub release's
//! `latest.json` asset URL directly (unauthenticated, newest-first).

use std::time::Duration;

use serde_json::Value;
use url::Url;

const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/qlan-ro/mainframe/releases";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum UpdateChannel {
    Stable,
    Prerelease,
}

/// Read `updateChannel` from `GET /api/settings/general`. Defaults to
/// `Stable` on any failure (offline daemon, non-200, malformed JSON, missing
/// field) so a broken lookup never silently opts a user into prereleases.
pub fn resolve_channel(daemon_port: u16) -> UpdateChannel {
    fetch_channel(daemon_port).unwrap_or(UpdateChannel::Stable)
}

fn fetch_channel(daemon_port: u16) -> Result<UpdateChannel, String> {
    let url = format!("http://127.0.0.1:{daemon_port}/api/settings/general");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_millis(500))
        .timeout_read(Duration::from_millis(500))
        .build();
    let body = agent
        .get(&url)
        .call()
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())?;
    Ok(parse_channel_response(&body))
}

/// Pure parse of the `{ success, data: { updateChannel } }` envelope.
/// Factored out from the network call so it's unit-testable without a daemon.
fn parse_channel_response(body: &str) -> UpdateChannel {
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return UpdateChannel::Stable;
    };
    match value["data"]["updateChannel"].as_str() {
        Some("prerelease") => UpdateChannel::Prerelease,
        _ => UpdateChannel::Stable,
    }
}

/// Resolve the prerelease update endpoint. Returns `None` on any failure
/// (offline, rate-limited, no matching release/asset, parse error) — callers
/// must fall back to the static stable endpoint rather than hard-failing.
pub fn resolve_prerelease_endpoint() -> Option<Url> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(3))
        .timeout_read(Duration::from_secs(3))
        .build();
    let body = agent
        .get(GITHUB_RELEASES_URL)
        .set("User-Agent", "mainframe-updater")
        .call()
        .ok()?
        .into_string()
        .ok()?;
    let url_str = select_latest_json_url(&body)?;
    Url::parse(&url_str).ok()
}

/// Pure selection logic: skip draft releases, take the first remaining entry
/// regardless of its `prerelease` flag, and return its `latest.json` asset's
/// `browser_download_url`. Kept separate from the network call for unit tests.
fn select_latest_json_url(releases_json: &str) -> Option<String> {
    let releases: Value = serde_json::from_str(releases_json).ok()?;
    let release = releases
        .as_array()?
        .iter()
        .find(|r| r["draft"].as_bool() != Some(true))?;
    let asset = release["assets"]
        .as_array()?
        .iter()
        .find(|a| a["name"].as_str() == Some("latest.json"))?;
    asset["browser_download_url"].as_str().map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(draft: bool, prerelease: bool, assets: &str) -> String {
        format!(
            r#"{{"draft":{draft},"prerelease":{prerelease},"assets":{assets}}}"#
        )
    }

    fn asset(name: &str, url: &str) -> String {
        format!(r#"{{"name":"{name}","browser_download_url":"{url}"}}"#)
    }

    #[test]
    fn parse_channel_response_reads_prerelease() {
        let body = r#"{"success":true,"data":{"updateChannel":"prerelease"}}"#;
        assert_eq!(parse_channel_response(body), UpdateChannel::Prerelease);
    }

    #[test]
    fn parse_channel_response_reads_stable() {
        let body = r#"{"success":true,"data":{"updateChannel":"stable"}}"#;
        assert_eq!(parse_channel_response(body), UpdateChannel::Stable);
    }

    #[test]
    fn parse_channel_response_defaults_stable_on_missing_field() {
        assert_eq!(
            parse_channel_response(r#"{"success":true,"data":{}}"#),
            UpdateChannel::Stable
        );
    }

    #[test]
    fn parse_channel_response_defaults_stable_on_malformed_json() {
        assert_eq!(parse_channel_response("not json"), UpdateChannel::Stable);
    }

    #[test]
    fn select_latest_json_url_skips_drafts() {
        let json = format!(
            "[{},{}]",
            release(true, false, &format!("[{}]", asset("latest.json", "https://example.com/draft.json"))),
            release(false, false, &format!("[{}]", asset("latest.json", "https://example.com/real.json")))
        );
        assert_eq!(
            select_latest_json_url(&json).as_deref(),
            Some("https://example.com/real.json")
        );
    }

    #[test]
    fn select_latest_json_url_takes_first_regardless_of_prerelease_flag() {
        let json = format!(
            "[{},{}]",
            release(false, true, &format!("[{}]", asset("latest.json", "https://example.com/rc.json"))),
            release(false, false, &format!("[{}]", asset("latest.json", "https://example.com/stable.json")))
        );
        assert_eq!(
            select_latest_json_url(&json).as_deref(),
            Some("https://example.com/rc.json")
        );
    }

    #[test]
    fn select_latest_json_url_finds_asset_among_others() {
        let assets = format!(
            "[{},{}]",
            asset("app.tar.gz", "https://example.com/app.tar.gz"),
            asset("latest.json", "https://example.com/latest.json")
        );
        let json = format!("[{}]", release(false, false, &assets));
        assert_eq!(
            select_latest_json_url(&json).as_deref(),
            Some("https://example.com/latest.json")
        );
    }

    #[test]
    fn select_latest_json_url_none_when_all_draft() {
        let json = format!(
            "[{}]",
            release(true, false, &format!("[{}]", asset("latest.json", "https://example.com/draft.json")))
        );
        assert_eq!(select_latest_json_url(&json), None);
    }

    #[test]
    fn select_latest_json_url_none_when_no_matching_asset() {
        let json = format!(
            "[{}]",
            release(false, false, &format!("[{}]", asset("app.tar.gz", "https://example.com/app.tar.gz")))
        );
        assert_eq!(select_latest_json_url(&json), None);
    }

    #[test]
    fn select_latest_json_url_none_on_malformed_json() {
        assert_eq!(select_latest_json_url("not json"), None);
        assert_eq!(select_latest_json_url("[]"), None);
    }
}
