use std::cmp::Ordering;
use std::fmt;
use std::str::FromStr;
use std::time::Duration;

use mainframe_runtime::ResolvedPath;

/// How long a `--version` probe may take before the CLI is treated as absent.
pub const VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Run `<executable> --version` on `path`; the stdout when it exits 0, `None`
/// when it cannot be spawned, fails, or outlives [`VERSION_PROBE_TIMEOUT`]
/// (the child is killed and reaped on the way out).
pub async fn version_stdout(executable: &str, path: &ResolvedPath) -> Option<String> {
    let mut command = tokio::process::Command::new(executable);
    command.arg("--version");
    path.apply(&mut command);
    let output = mainframe_runtime::process::run_captured(command, Some(VERSION_PROBE_TIMEOUT))
        .await
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// A CLI version triple, retaining its original spelling for wire display.
#[derive(Debug, Clone)]
pub struct CliVersion {
    major: String,
    minor: String,
    patch: String,
}

impl CliVersion {
    /// Finds the first three-component numeric version in CLI output.
    pub fn parse(output: &str) -> Option<Self> {
        output
            .bytes()
            .enumerate()
            .filter(|(_, byte)| byte.is_ascii_digit())
            .find_map(|(start, _)| Self::parse_at(&output[start..]))
    }

    /// The `major.minor.patch` run at the start of `s`, if there is one.
    fn parse_at(s: &str) -> Option<Self> {
        let (major, rest) = leading_digits(s)?;
        let (minor, rest) = leading_digits(rest.strip_prefix('.')?)?;
        let (patch, _) = leading_digits(rest.strip_prefix('.')?)?;
        Some(Self {
            major: major.to_string(),
            minor: minor.to_string(),
            patch: patch.to_string(),
        })
    }

    /// Parses a version that starts at the first byte, accepting a patch suffix.
    pub fn parse_leading(output: &str) -> Option<Self> {
        Self::parse(output).filter(|version| output.starts_with(&version.to_string()))
    }

    /// The three components as numbers, or `None` when one overflows `T`.
    pub fn components<T: FromStr>(&self) -> Option<(T, T, T)> {
        Some((
            self.major.parse().ok()?,
            self.minor.parse().ok()?,
            self.patch.parse().ok()?,
        ))
    }

    pub fn at_least(&self, major: u64, minor: u64, patch: u64) -> bool {
        let required = Self {
            major: major.to_string(),
            minor: minor.to_string(),
            patch: patch.to_string(),
        };
        self >= &required
    }
}

/// The non-empty run of ASCII digits at the start of `s`, and the rest.
fn leading_digits(s: &str) -> Option<(&str, &str)> {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    (end > 0).then(|| s.split_at(end))
}

fn cmp_component(left: &str, right: &str) -> Ordering {
    let left = left.trim_start_matches('0');
    let right = right.trim_start_matches('0');
    left.len().cmp(&right.len()).then_with(|| left.cmp(right))
}

impl PartialEq for CliVersion {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for CliVersion {}

impl Ord for CliVersion {
    fn cmp(&self, other: &Self) -> Ordering {
        cmp_component(&self.major, &other.major)
            .then_with(|| cmp_component(&self.minor, &other.minor))
            .then_with(|| cmp_component(&self.patch, &other.patch))
    }
}

impl PartialOrd for CliVersion {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl fmt::Display for CliVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

#[cfg(test)]
#[path = "version_tests.rs"]
mod tests;
