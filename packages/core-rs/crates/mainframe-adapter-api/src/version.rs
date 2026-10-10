use std::cmp::Ordering;
use std::fmt;
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
        let bytes = output.as_bytes();
        for start in 0..bytes.len() {
            if !bytes[start].is_ascii_digit() {
                continue;
            }
            let mut end = start;
            let mut parts = Vec::with_capacity(3);
            for component in 0..3 {
                let from = end;
                while end < bytes.len() && bytes[end].is_ascii_digit() {
                    end += 1;
                }
                if from == end {
                    break;
                }
                parts.push(output[from..end].to_string());
                if component < 2 {
                    if bytes.get(end) != Some(&b'.') {
                        break;
                    }
                    end += 1;
                }
            }
            if parts.len() == 3 {
                return Some(Self {
                    major: parts.remove(0),
                    minor: parts.remove(0),
                    patch: parts.remove(0),
                });
            }
        }
        None
    }

    /// Parses a version that starts at the first byte, accepting a patch suffix.
    pub fn parse_leading(output: &str) -> Option<Self> {
        Self::parse(output).filter(|version| output.starts_with(&version.to_string()))
    }

    pub fn components_u32(&self) -> Option<(u32, u32, u32)> {
        Some((
            self.major.parse().ok()?,
            self.minor.parse().ok()?,
            self.patch.parse().ok()?,
        ))
    }

    pub fn components_u64(&self) -> Option<(u64, u64, u64)> {
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
mod tests {
    use super::CliVersion;

    #[test]
    fn extracts_and_displays_first_triple_without_rewriting_digits() {
        assert_eq!(
            CliVersion::parse("claude 02.1.198 (build 7)")
                .unwrap()
                .to_string(),
            "02.1.198"
        );
        assert_eq!(CliVersion::parse("no version"), None);
    }

    #[test]
    fn compares_numeric_components_even_when_they_overflow_u64() {
        let newer = CliVersion::parse("184467440737095516160.0.0").unwrap();
        assert!(newer > CliVersion::parse("9.999.999").unwrap());
        assert!(
            CliVersion::parse("1.0.109-beta")
                .unwrap()
                .at_least(1, 0, 109)
        );
        assert!(!CliVersion::parse("1.0.108").unwrap().at_least(1, 0, 109));
    }
}
