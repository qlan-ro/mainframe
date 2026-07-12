//! Ported from `src/server/ripgrep.ts`.
//!
//! Content and file-name search by shelling out to ripgrep with the exact same
//! flags as the TS module, plus the JSON-line output parser. Ripgrep is optional:
//! when the binary cannot be resolved the search routes fall back to their JS
//! walk, so every entry point degrades to "unavailable" rather than erroring.
//!
//! Binary resolution order (records the packaging seam): `MAINFRAME_RG_PATH` env
//! override → the dev `@vscode/ripgrep` binary under `packages/core/node_modules`
//! → `rg` on `PATH`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use mainframe_types::search::SearchContentResult;
use tokio::process::Command;

use crate::fs_utils::{IGNORED_DIRS, relative};

const MAX_LINE_LENGTH: usize = 500;
const TIMEOUT_MS: u64 = 30_000;
const DEFAULT_MAX_RESULTS: usize = 200;

/// Parse ripgrep's `--json` output into search results. Tolerates non-JSON lines
/// and non-`match` events; stops at `max_results`. Paths are re-based relative to
/// `base_path`; the matched line is trailing-newline-stripped and length-capped.
pub fn parse_ripgrep_output(
    output: &str,
    base_path: &str,
    max_results: usize,
) -> Vec<SearchContentResult> {
    let mut results: Vec<SearchContentResult> = Vec::new();

    for line in output.split('\n') {
        if results.len() >= max_results {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        let parsed: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if parsed.get("type").and_then(|t| t.as_str()) != Some("match") {
            continue;
        }
        let Some(data) = parsed.get("data") else {
            continue;
        };

        let file_path = data
            .get("path")
            .and_then(|p| p.get("text"))
            .and_then(|t| t.as_str());
        let line_number = data.get("line_number").and_then(|n| n.as_i64());
        let line_text = data
            .get("lines")
            .and_then(|l| l.get("text"))
            .and_then(|t| t.as_str());

        let (Some(file_path), Some(line_number), Some(line_text)) =
            (file_path, line_number, line_text)
        else {
            continue;
        };
        // TS treats `line_number === 0` as falsy → skip.
        if line_number == 0 {
            continue;
        }

        let rel_file = relative(Path::new(base_path), Path::new(file_path));
        let text: String = line_text
            .strip_suffix('\n')
            .unwrap_or(line_text)
            .chars()
            .take(MAX_LINE_LENGTH)
            .collect();
        let start = data
            .get("submatches")
            .and_then(|s| s.as_array())
            .and_then(|a| a.first())
            .and_then(|m| m.get("start"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        results.push(SearchContentResult {
            file: rel_file,
            line: line_number,
            column: start + 1,
            text,
        });
    }

    results
}

/// Resolve the ripgrep binary once (memoized). See the module docs for the
/// resolution order. The one-time stat/`PATH` scan runs behind a `OnceLock`, so
/// it never repeats on the per-request path.
fn rg_path() -> Option<PathBuf> {
    static RG: OnceLock<Option<PathBuf>> = OnceLock::new();
    RG.get_or_init(|| {
        // 1. Explicit override — trusted verbatim (packaging stages the sidecar rg here).
        if let Ok(p) = std::env::var("MAINFRAME_RG_PATH")
            && !p.is_empty()
        {
            return Some(PathBuf::from(p));
        }
        // 2. Dev: the @vscode/ripgrep binary vendored under packages/core. The
        //    compile-time manifest dir is packages/core-rs/crates/mainframe-server.
        let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../core/node_modules/@vscode/ripgrep/bin/rg");
        if dev.is_file() {
            return Some(dev);
        }
        // 3. `rg` on PATH.
        find_on_path("rg")
    })
    .clone()
}

fn find_on_path(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(bin))
        .find(|candidate| candidate.is_file())
}

/// True when the ripgrep binary resolved. Mirrors `isRipgrepAvailable`.
pub fn is_ripgrep_available() -> bool {
    rg_path().is_some()
}

/// Options for [`search_with_ripgrep`]. `None` fields take the TS defaults.
#[derive(Debug, Clone, Default)]
pub struct RipgrepOptions {
    pub max_results: Option<usize>,
    pub max_file_size: Option<String>,
    pub include_ignored: bool,
}

/// Content search via `rg --json`. Returns `[]` when ripgrep is unavailable or on
/// any process error (the route then decides whether to fall back).
pub async fn search_with_ripgrep(
    scope_path: &str,
    query: &str,
    opts: &RipgrepOptions,
) -> Vec<SearchContentResult> {
    let Some(rg) = rg_path() else {
        return Vec::new();
    };
    let max_results = opts.max_results.unwrap_or(DEFAULT_MAX_RESULTS);
    let max_file_size = opts
        .max_file_size
        .clone()
        .unwrap_or_else(|| "1M".to_string());

    let mut args: Vec<String> = vec![
        "--json".into(),
        "--ignore-case".into(),
        "--max-filesize".into(),
        max_file_size,
        "--no-require-git".into(),
        "--max-count".into(),
        "50".into(),
    ];
    if opts.include_ignored {
        args.push("--no-ignore".into());
        args.push("--hidden".into());
    }
    args.push("--".into());
    args.push(query.to_string());
    args.push(scope_path.to_string());

    match run_rg(&rg, &args).await {
        Some(stdout) if !stdout.is_empty() => {
            parse_ripgrep_output(&stdout, scope_path, max_results)
        }
        _ => Vec::new(),
    }
}

/// Options for [`list_files_with_ripgrep`].
#[derive(Debug, Clone, Default)]
pub struct ListFilesOptions {
    pub include_ignored: bool,
    pub use_builtin_ignore_only: bool,
}

/// List files via `rg --files`, returned relative to `dir_path`. `None` when
/// ripgrep is unavailable or the process fails (the route walks instead).
pub async fn list_files_with_ripgrep(
    dir_path: &str,
    opts: &ListFilesOptions,
) -> Option<Vec<String>> {
    let rg = rg_path()?;

    let mut args: Vec<String> = vec!["--files".into(), "--no-require-git".into()];
    if opts.use_builtin_ignore_only {
        // Skip .gitignore so gitignored config files (e.g. .env) surface, but
        // still exclude build-artifact directories via explicit globs.
        args.push("--no-ignore".into());
        args.push("--hidden".into());
        for dir in IGNORED_DIRS {
            args.push("--glob".into());
            args.push(format!("!**/{dir}/**"));
        }
    } else if opts.include_ignored {
        args.push("--no-ignore".into());
        args.push("--hidden".into());
    }
    args.push(dir_path.to_string());

    let stdout = run_rg_strict(&rg, &args).await?;
    Some(
        stdout
            .split('\n')
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(|abs| relative(Path::new(dir_path), Path::new(abs)))
            .collect(),
    )
}

/// Run rg and return stdout; `None` on spawn/timeout. Non-zero exits (e.g. exit 1
/// = no matches) still yield their captured stdout — the parser tolerates empty.
async fn run_rg(rg: &Path, args: &[String]) -> Option<String> {
    let output = spawn_rg(rg, args).await?;
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Like [`run_rg`] but treats a non-zero exit as failure (`None`), matching
/// `listFilesWithRipgrep`'s `if (err) resolve(null)`.
async fn run_rg_strict(rg: &Path, args: &[String]) -> Option<String> {
    let output = spawn_rg(rg, args).await?;
    if !output.status.success() {
        tracing::warn!("ripgrep --files failed");
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

async fn spawn_rg(rg: &Path, args: &[String]) -> Option<std::process::Output> {
    let child = Command::new(rg)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();
    let child = match child {
        Ok(c) => c,
        Err(err) => {
            tracing::warn!(error = %err, "ripgrep process error");
            return None;
        }
    };
    match tokio::time::timeout(Duration::from_millis(TIMEOUT_MS), child.wait_with_output()).await {
        Ok(Ok(output)) => Some(output),
        Ok(Err(err)) => {
            tracing::warn!(error = %err, "ripgrep process error");
            None
        }
        Err(_) => {
            tracing::warn!("ripgrep timed out");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_match_events_into_results() {
        let out = concat!(
            r#"{"type":"begin","data":{"path":{"text":"/base/a.txt"}}}"#,
            "\n",
            r#"{"type":"match","data":{"path":{"text":"/base/a.txt"},"line_number":3,"lines":{"text":"hello world\n"},"submatches":[{"start":6}]}}"#,
            "\n",
            "not json",
            "\n",
        );
        let results = parse_ripgrep_output(out, "/base", 200);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].file, "a.txt");
        assert_eq!(results[0].line, 3);
        assert_eq!(results[0].column, 7);
        assert_eq!(results[0].text, "hello world");
    }

    #[test]
    fn skips_matches_missing_required_fields() {
        let out = r#"{"type":"match","data":{"path":{"text":"/base/a.txt"},"line_number":0,"lines":{"text":"x"}}}"#;
        assert!(parse_ripgrep_output(out, "/base", 200).is_empty());
    }

    #[test]
    fn honors_max_results() {
        let line = r#"{"type":"match","data":{"path":{"text":"/base/a.txt"},"line_number":1,"lines":{"text":"m"},"submatches":[{"start":0}]}}"#;
        let out = format!("{line}\n{line}\n{line}");
        assert_eq!(parse_ripgrep_output(&out, "/base", 2).len(), 2);
    }
}

// PORT STATUS: src/server/ripgrep.ts (parseRipgrepOutput, getRgPath,
// searchWithRipgrep, listFilesWithRipgrep, isRipgrepAvailable)
// confidence: medium
// todos: 1
// notes: `execFile` → `tokio::process::Command` (array args, no shell) with the
// 30s timeout + kill-on-drop; the `maxBuffer: 10mb` cap has no direct analogue
// (rg's `--max-count 50` / `--max-filesize` bound output). Binary resolution:
// TODO(port) packaging — TS `require('@vscode/ripgrep')` resolves the vendored
// binary; Rust uses MAINFRAME_RG_PATH → dev `packages/core/node_modules` path
// (baked via CARGO_MANIFEST_DIR, absent in a packaged build) → `rg` on PATH, so
// the packaged daemon MUST set MAINFRAME_RG_PATH to the bundled sidecar rg. The
// one-time resolution stats behind a OnceLock (off the per-request hot path).
// `line.slice(0,500)` (UTF-16 units) → first 500 chars (UTF-8 safe).
