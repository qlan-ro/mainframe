//! Why `mainframe update` stopped. The text is what the command prints.

use reqwest::StatusCode;

#[derive(Debug, thiserror::Error)]
pub(crate) enum UpdateError {
    #[error("Unknown argument: {0}")]
    UnknownArgument(String),
    #[error(
        "Could not locate a standalone install to update. This looks like a dev or \
         non-standalone build. Re-run the install script instead:\n  curl -fsSL \
         https://raw.githubusercontent.com/qlan-ro/mainframe/main/scripts/install.sh | bash"
    )]
    NoStandaloneInstall,
    #[error("Could not resolve the running binary path: {0}")]
    CurrentExe(#[source] std::io::Error),
    #[error("Unsupported platform for self-update: {platform}-{arch}")]
    UnsupportedPlatform { platform: String, arch: String },
    #[error("No release found for version {0}")]
    NoSuchVersion(String),
    #[error(
        "No matching release found.{}",
        if *.only_prereleases { " Only pre-releases exist — retry with `mainframe update --pre`." } else { "" }
    )]
    NoMatchingRelease { only_prereleases: bool },
    #[error("Release {tag} does not include {artifact}.")]
    MissingAsset { tag: String, artifact: String },
    #[error(
        "{tag} is not newer than the running version (v{current}). Refusing to downgrade — pass --force to override."
    )]
    NotNewer { tag: String, current: String },
    #[error("GitHub API request failed for {url}: {source}")]
    GitHubRequest {
        url: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("GitHub API returned {status} for {url}")]
    GitHubStatus { status: StatusCode, url: String },
    #[error("Failed to parse the GitHub API response: {0}")]
    GitHubDecode(#[source] reqwest::Error),
    #[error("Could not create a temp dir for the download: {0}")]
    TempDir(#[source] std::io::Error),
    #[error("Download failed for {url}: {source}")]
    Download {
        url: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("Download failed ({status}) for {url}")]
    DownloadStatus { status: StatusCode, url: String },
    #[error("Download failed while reading {url}: {source}")]
    DownloadRead {
        url: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("Could not write {path}: {source}")]
    WriteTarball {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("Failed to run tar: {0}")]
    TarSpawn(#[source] std::io::Error),
    #[error("tar exited with status {0}")]
    TarStatus(std::process::ExitStatus),
}
