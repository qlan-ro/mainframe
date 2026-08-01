//! The GitHub CLI is Mainframe's only path to the GitHub API. `gh` already
//! owns a token — in the OS keyring, refreshed by `gh auth login` — so the
//! connectors below never ask for, store, or transmit a credential of their
//! own. The cost is a hard dependency: without `gh` the GitHub actions can't
//! run, so the catalog mutes them (`availability`) instead of offering a step
//! that always fails.

use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::ActionError;

/// Truncation bound for `gh`'s stderr in a step failure — matches the
/// connectors' HTTP body snippet so timelines stay readable.
const STDERR_SNIPPET_CHARS: usize = 500;

/// `gh auth status` calls the API to validate the token, so every catalog
/// load would otherwise pay a round trip per GitHub action. Short enough
/// that a `gh auth login` in another terminal un-mutes the actions promptly.
const STATUS_TTL: Duration = Duration::from_secs(30);

const INSTALL_HINT: &str =
    "Install the GitHub CLI from https://cli.github.com, then run `gh auth login`.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GhStatus {
    Ready,
    NotInstalled,
    NotAuthenticated,
}

impl GhStatus {
    /// UI copy for a muted catalog entry, and the step error when an action
    /// is run anyway — one sentence, one remedy.
    pub(crate) fn unavailable_reason(&self) -> Option<String> {
        match self {
            Self::Ready => None,
            Self::NotInstalled => Some(format!("The GitHub CLI isn't installed. {INSTALL_HINT}")),
            Self::NotAuthenticated => {
                Some("The GitHub CLI isn't signed in. Run `gh auth login`.".to_string())
            }
        }
    }
}

/// A `gh` invocation. The binary is injectable so tests can point at a stub
/// script instead of the developer's real, authenticated CLI. Clones share
/// the status cache, so the two GitHub actions probe once between them.
#[derive(Debug, Clone)]
pub(crate) struct GhCli {
    bin: String,
    status_cache: Arc<Mutex<Option<(Instant, GhStatus)>>>,
}

impl GhCli {
    pub(crate) fn new() -> Self {
        Self::with_bin("gh")
    }

    pub(crate) fn with_bin(bin: impl Into<String>) -> Self {
        Self {
            bin: bin.into(),
            status_cache: Arc::new(Mutex::new(None)),
        }
    }

    /// `gh auth status` deliberately, not `gh auth token`: it reports the
    /// same three outcomes without ever putting the token in our process.
    pub(crate) async fn status(&self) -> GhStatus {
        if let Some(cached) = self.cached_status() {
            return cached;
        }
        let status = match self.run(&["auth", "status"], None).await {
            Ok(_) => GhStatus::Ready,
            Err(GhFailure::NotInstalled) => GhStatus::NotInstalled,
            Err(GhFailure::Exit { .. }) => GhStatus::NotAuthenticated,
        };
        if let Ok(mut cache) = self.status_cache.lock() {
            *cache = Some((Instant::now(), status.clone()));
        }
        status
    }

    fn cached_status(&self) -> Option<GhStatus> {
        let cache = self.status_cache.lock().ok()?;
        let (at, status) = cache.as_ref()?;
        (at.elapsed() < STATUS_TTL).then(|| status.clone())
    }

    /// Runs `gh` and returns stdout, mapping both failure modes to the step
    /// error text the run timeline shows.
    pub(crate) async fn output(
        &self,
        op: &str,
        args: &[&str],
        stdin: Option<&str>,
    ) -> Result<String, ActionError> {
        self.run(args, stdin)
            .await
            .map_err(|failure| match failure {
                GhFailure::NotInstalled => ActionError(format!(
                    "{op} failed: the GitHub CLI isn't installed. {INSTALL_HINT}"
                )),
                GhFailure::Exit { code, stderr } => {
                    let snippet: String =
                        stderr.trim().chars().take(STDERR_SNIPPET_CHARS).collect();
                    ActionError(format!("{op} failed (gh exited {code}): {snippet}"))
                }
            })
    }

    async fn run(&self, args: &[&str], stdin: Option<&str>) -> Result<String, GhFailure> {
        let mut child = Command::new(&self.bin)
            .args(args)
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Same reason run_command sets it: a cancelled run drops this
            // future, and without kill_on_drop the CLI would outlive it.
            .kill_on_drop(true)
            .spawn()
            .map_err(|err| match err.kind() {
                std::io::ErrorKind::NotFound => GhFailure::NotInstalled,
                _ => GhFailure::Exit {
                    code: -1,
                    stderr: err.to_string(),
                },
            })?;

        if let Some(body) = stdin
            && let Some(mut pipe) = child.stdin.take()
        {
            let write = async {
                pipe.write_all(body.as_bytes()).await?;
                pipe.shutdown().await
            };
            if let Err(err) = write.await {
                return Err(GhFailure::Exit {
                    code: -1,
                    stderr: format!("failed to send the request body to gh: {err}"),
                });
            }
        }

        let output = child
            .wait_with_output()
            .await
            .map_err(|err| GhFailure::Exit {
                code: -1,
                stderr: err.to_string(),
            })?;
        if !output.status.success() {
            return Err(GhFailure::Exit {
                code: output.status.code().unwrap_or(-1),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

enum GhFailure {
    NotInstalled,
    Exit { code: i32, stderr: String },
}

/// `owner/repo`, the only shape `gh api repos/<repo>/…` can take. Rejecting
/// anything else keeps a user-supplied value from reshaping the endpoint
/// path (extra segments, `..`, a query string).
pub(crate) fn validate_repo(action_id: &str, repo: &str) -> Result<(), ActionError> {
    let mut parts = repo.split('/');
    let valid = matches!((parts.next(), parts.next(), parts.next()), (Some(owner), Some(name), None)
        if is_repo_segment(owner) && is_repo_segment(name));
    if valid {
        return Ok(());
    }
    Err(ActionError(format!(
        "invalid input for '{action_id}': repo '{repo}' must be 'owner/name'"
    )))
}

fn is_repo_segment(segment: &str) -> bool {
    // Dots are legal inside a repo name, so the charset alone would admit
    // `..` — a segment that walks the endpoint path up instead of naming a
    // repo. Requiring one non-dot character rules out `.` and `..` without
    // rejecting `my.repo`.
    segment.bytes().any(|b| b != b'.')
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

// PORT STATUS: greenfield (no TS counterpart — the Node connector used a raw HTTP client)
// confidence: high
// todos: 0
// notes: replaces the reqwest GitHub client; auth lives in `gh`, never here.
