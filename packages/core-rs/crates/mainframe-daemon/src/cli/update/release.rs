//! Ported from the release-picking parts of `packages/core/src/cli/update.ts`.
//!
//! Pure logic only — no I/O — so it can be unit-tested against hardcoded
//! expectations without a network or filesystem (the parity oracle is
//! `packages/core/src/cli/__tests__/update.test.ts`).

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct GhAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GhRelease {
    pub tag_name: String,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub assets: Vec<GhAsset>,
}

/// `standaloneArtifactName()` — maps the running platform to the release
/// artifact filename it should install.
pub fn standalone_artifact_name(platform: &str, arch: &str) -> Result<String, String> {
    let os = match platform {
        "darwin" => Some("darwin"),
        "linux" => Some("linux"),
        _ => None,
    };
    let cpu = match arch {
        "x64" => Some("x64"),
        "arm64" => Some("arm64"),
        _ => None,
    };
    match (os, cpu) {
        (Some(os), Some(cpu)) => Ok(format!("mainframe-daemon-{os}-{cpu}.tar.gz")),
        _ => Err(format!(
            "Unsupported platform for self-update: {platform}-{arch}"
        )),
    }
}

/// `pickRelease()` — picks the release to install from a GitHub `/releases`
/// list (newest first), honoring an explicit `version` or the newest
/// stable/pre-release per `include_prerelease`.
pub fn pick_release(
    releases: &[GhRelease],
    version: Option<&str>,
    include_prerelease: bool,
) -> Result<GhRelease, String> {
    let published: Vec<&GhRelease> = releases.iter().filter(|r| !r.draft).collect();

    if let Some(version) = version {
        let norm = |t: &str| t.trim_start_matches('v').to_string();
        return published
            .iter()
            .find(|r| r.tag_name == version || norm(&r.tag_name) == norm(version))
            .map(|r| (*r).clone())
            .ok_or_else(|| format!("No release found for version {version}"));
    }

    if let Some(newest) = published
        .iter()
        .find(|r| include_prerelease || !r.prerelease)
    {
        return Ok((*newest).clone());
    }

    let hint = if published.iter().any(|r| r.prerelease) {
        " Only pre-releases exist — retry with `mainframe update --pre`."
    } else {
        ""
    };
    Err(format!("No matching release found.{hint}"))
}

/// `assetUrl()` — resolves the download URL of `artifact` within a release.
pub fn asset_url(release: &GhRelease, artifact: &str) -> Result<String, String> {
    release
        .assets
        .iter()
        .find(|a| a.name == artifact)
        .map(|a| a.browser_download_url.clone())
        .ok_or_else(|| format!("Release {} does not include {artifact}.", release.tag_name))
}

#[derive(Debug, Default)]
struct SemVer {
    major: i64,
    minor: i64,
    patch: i64,
    prerelease: Vec<String>,
}

/// `parseSemver()`. Tolerates a leading `v`; non-numeric core segments parse
/// as 0, matching the TS `Number(n) || 0`.
fn parse_semver(version: &str) -> SemVer {
    let version = version.trim_start_matches('v');
    let mut segments = version.split('-');
    let core = segments.next().unwrap_or("");
    let prerelease_str = segments.collect::<Vec<_>>().join("-");

    let mut nums = core.split('.').map(|n| n.parse::<i64>().unwrap_or(0));
    SemVer {
        major: nums.next().unwrap_or(0),
        minor: nums.next().unwrap_or(0),
        patch: nums.next().unwrap_or(0),
        prerelease: if prerelease_str.is_empty() {
            Vec::new()
        } else {
            prerelease_str.split('.').map(String::from).collect()
        },
    }
}

/// `compareSemver()` — negative if `a` < `b`, 0 if equal, positive if `a` > `b`.
pub fn compare_semver(a: &str, b: &str) -> i64 {
    let va = parse_semver(a);
    let vb = parse_semver(b);
    if va.major != vb.major {
        return va.major - vb.major;
    }
    if va.minor != vb.minor {
        return va.minor - vb.minor;
    }
    if va.patch != vb.patch {
        return va.patch - vb.patch;
    }
    // A release with no prerelease suffix outranks one with the same core version.
    if va.prerelease.is_empty() && !vb.prerelease.is_empty() {
        return 1;
    }
    if !va.prerelease.is_empty() && vb.prerelease.is_empty() {
        return -1;
    }
    compare_prerelease(&va.prerelease, &vb.prerelease)
}

fn compare_prerelease(pa: &[String], pb: &[String]) -> i64 {
    let len = pa.len().max(pb.len());
    for i in 0..len {
        let (a, b) = (pa.get(i), pb.get(i));
        let (a, b) = match (a, b) {
            (None, _) => return -1,
            (_, None) => return 1,
            (Some(a), Some(b)) => (a, b),
        };
        let na = a.parse::<i64>().ok().filter(|_| !a.is_empty());
        let nb = b.parse::<i64>().ok().filter(|_| !b.is_empty());
        match (na, nb) {
            (Some(na), Some(nb)) if na != nb => return na - nb,
            (Some(_), Some(_)) => continue,
            (Some(_), None) => return -1, // numeric identifiers rank below alphanumeric (semver 11.4.4)
            (None, Some(_)) => return 1,
            (None, None) if a != b => return if a < b { -1 } else { 1 },
            (None, None) => continue,
        }
    }
    0
}

/// `assertNotDowngrade()` — refuses to install a release that isn't newer
/// than `current_version`, unless `force` is set.
pub fn assert_not_downgrade(
    release: &GhRelease,
    current_version: &str,
    force: bool,
) -> Result<(), String> {
    if force || compare_semver(&release.tag_name, current_version) > 0 {
        return Ok(());
    }
    Err(format!(
        "{} is not newer than the running version (v{current_version}). Refusing to downgrade — pass --force to override.",
        release.tag_name
    ))
}

#[cfg(test)]
mod tests;
