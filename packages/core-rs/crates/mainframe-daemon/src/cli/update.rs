//! Ported from `packages/core/src/cli/update.ts` — `mainframe update`.
//!
//! Self-updates a standalone install in place: picks a GitHub release, refuses
//! a downgrade unless `--force`, downloads the matching platform tarball, and
//! extracts it over the install root with a `tar` shell-out (matching the TS
//! twin's `execFile('tar', ...)`). Release-picking/semver logic lives in
//! `release` (pure, unit-tested); this module owns argv parsing, install-root
//! resolution, and the network/process orchestration.

mod release;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use release::{assert_not_downgrade, asset_url, pick_release, standalone_artifact_name};
use serde::Deserialize;

const REPO: &str = "qlan-ro/mainframe";

/// Parsed `mainframe update` flags (`packages/core/src/cli/update.ts`'s `UpdateOptions`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UpdateOptions {
    pub version: Option<String>,
    pub include_prerelease: bool,
    pub force: bool,
    pub help: bool,
    pub dir: Option<String>,
}

/// `parseUpdateArgs()`.
pub fn parse_update_args(argv: &[String]) -> Result<UpdateOptions, String> {
    let mut opts = UpdateOptions::default();
    let mut i = 0;
    while i < argv.len() {
        match argv[i].as_str() {
            "--pre" | "--prerelease" => opts.include_prerelease = true,
            "--force" => opts.force = true,
            "-h" | "--help" => opts.help = true,
            "--version" => {
                i += 1;
                opts.version = argv.get(i).cloned();
            }
            "--dir" => {
                i += 1;
                opts.dir = argv.get(i).cloned();
            }
            other => return Err(format!("Unknown argument: {other}")),
        }
        i += 1;
    }
    Ok(opts)
}

/// `resolveInstallRoot()`. The standalone layout has no `lib/` anymore (T5.3
/// drops the Node bundle), so the marker is the daemon binary itself:
/// `bin/mainframe-daemon` beside the `mainframe` wrapper.
pub fn resolve_install_root(
    env: &HashMap<String, String>,
    exe_path: &Path,
) -> Result<PathBuf, String> {
    if let Some(root) = env.get("MAINFRAME_STANDALONE_ROOT") {
        let candidate = PathBuf::from(root);
        if is_standalone_root(&candidate) {
            return Ok(candidate);
        }
    }

    if let Some(derived) = exe_path.parent().and_then(Path::parent)
        && is_standalone_root(derived)
    {
        return Ok(derived.to_path_buf());
    }

    Err(
        "Could not locate a standalone install to update. This looks like a dev or \
         non-standalone build. Re-run the install script instead:\n  curl -fsSL \
         https://raw.githubusercontent.com/qlan-ro/mainframe/main/scripts/install.sh | bash"
            .to_string(),
    )
}

fn is_standalone_root(root: &Path) -> bool {
    root.join("bin").join("mainframe-daemon").is_file()
}

fn platform_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    }
}

fn arch_name() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    }
}

/// `runUpdate()`.
pub async fn run_update(argv: Vec<String>) -> Result<(), String> {
    let opts = parse_update_args(&argv).inspect_err(|_| print_usage())?;
    if opts.help {
        print_usage();
        return Ok(());
    }

    let root = resolve_root(&opts)?;
    let artifact = standalone_artifact_name(platform_name(), arch_name())?;

    println!("  Checking for updates…");
    let releases = fetch_releases(opts.version.as_deref()).await?;
    let release = pick_release(&releases, opts.version.as_deref(), opts.include_prerelease)?;
    assert_not_downgrade(&release, crate::DAEMON_VERSION, opts.force)?;
    let url = asset_url(&release, &artifact)?;

    println!(
        "  Installing {} ({artifact}) -> {}",
        release.tag_name,
        root.display()
    );
    install_release(&url, &artifact, &root).await?;

    println!("\n  Updated to {}.", release.tag_name);
    println!("  Restart the daemon for the update to take effect.\n");
    Ok(())
}

fn resolve_root(opts: &UpdateOptions) -> Result<PathBuf, String> {
    if let Some(dir) = &opts.dir {
        return Ok(PathBuf::from(dir));
    }
    let env: HashMap<String, String> = std::env::vars().collect();
    let exe = std::env::current_exe()
        .map_err(|err| format!("Could not resolve the running binary path: {err}"))?;
    resolve_install_root(&env, &exe)
}

// GitHub returns an array from `/releases` but a single object from
// `/releases/tags/<tag>` — untagged covers both response shapes.
#[derive(Deserialize)]
#[serde(untagged)]
enum ReleasesPayload {
    List(Vec<release::GhRelease>),
    Single(Box<release::GhRelease>),
}

async fn fetch_releases(version: Option<&str>) -> Result<Vec<release::GhRelease>, String> {
    let url = match version {
        Some(v) => format!("https://api.github.com/repos/{REPO}/releases/tags/{v}"),
        None => format!("https://api.github.com/repos/{REPO}/releases?per_page=30"),
    };
    let mut req = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", "mainframe-updater");
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    let res = req
        .send()
        .await
        .map_err(|err| format!("GitHub API request failed for {url}: {err}"))?;
    if !res.status().is_success() {
        return Err(format!("GitHub API returned {} for {url}", res.status()));
    }
    let payload: ReleasesPayload = res
        .json()
        .await
        .map_err(|err| format!("Failed to parse the GitHub API response: {err}"))?;
    Ok(match payload {
        ReleasesPayload::List(list) => list,
        ReleasesPayload::Single(release) => vec![*release],
    })
}

async fn install_release(url: &str, artifact: &str, root: &Path) -> Result<(), String> {
    let tmp_dir = std::env::temp_dir().join(format!("mainframe-update-{}", nanoid::nanoid!(8)));
    tokio::fs::create_dir_all(&tmp_dir)
        .await
        .map_err(|err| format!("Could not create a temp dir for the download: {err}"))?;
    let tarball = tmp_dir.join(artifact);

    let result = match download_tarball(url, &tarball).await {
        Ok(()) => extract_over(&tarball, root).await,
        Err(err) => Err(err),
    };

    let _ = tokio::fs::remove_dir_all(&tmp_dir).await; // best-effort cleanup /* expected */
    result
}

async fn download_tarball(url: &str, dest: &Path) -> Result<(), String> {
    let res = reqwest::Client::new()
        .get(url)
        .header("User-Agent", "mainframe-updater")
        .send()
        .await
        .map_err(|err| format!("Download failed for {url}: {err}"))?;
    if !res.status().is_success() {
        return Err(format!("Download failed ({}) for {url}", res.status()));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|err| format!("Download failed while reading {url}: {err}"))?;
    tokio::fs::write(dest, &bytes)
        .await
        .map_err(|err| format!("Could not write {}: {err}", dest.display()))?;
    Ok(())
}

// Extraction shells out to the system `tar` (matches the TS twin's
// `execFile('tar', ...)`) rather than pulling in a Rust tar/gzip crate.
async fn extract_over(tarball: &Path, root: &Path) -> Result<(), String> {
    let status = tokio::process::Command::new("tar")
        .arg("-xzf")
        .arg(tarball)
        .arg("-C")
        .arg(root)
        .arg("--strip-components=1")
        .status()
        .await
        .map_err(|err| format!("Failed to run tar: {err}"))?;
    if !status.success() {
        return Err(format!("tar exited with status {status}"));
    }
    Ok(())
}

fn print_usage() {
    println!(
        "\n  mainframe update — upgrade the standalone daemon in place\n\n  Usage: mainframe update [--pre] [--version <tag>] [--dir <path>] [--force]\n\n    --pre              include pre-releases when picking the newest\n    --version <tag>    install a specific release tag (e.g. v2.0.0-rc.1)\n    --dir <path>       install root to unpack over (default: auto-detected)\n    --force            allow installing a release that is not newer than the current one\n"
    );
}

#[cfg(test)]
mod tests;
