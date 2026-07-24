//! Ported from `src/server/ripgrep.ts`.
//!
//! Content and file-name search reimplemented in-process on ripgrep's own
//! library crates (`ignore` + `grep-searcher` + `grep-regex`, pinned to the
//! versions ripgrep 14.1.1 itself vendors) instead of shelling out to a
//! resolved `rg` binary. Search now always works — there is no more "ripgrep
//! unavailable, fall back to a JS walk" branch anywhere in the routes.

use std::path::Path;

use grep_regex::RegexMatcherBuilder;
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use mainframe_types::search::SearchContentResult;

use crate::fs_utils::{is_ignored_dir, relative};
use sink::ContentSink;

mod sink;

const DEFAULT_MAX_RESULTS: usize = 200;
const DEFAULT_MAX_FILE_SIZE: u64 = 1024 * 1024; // "1M", matches the old CLI default.

/// Options for [`search_with_ripgrep`]. `None` fields take the defaults above.
#[derive(Debug, Clone, Default)]
pub struct RipgrepOptions {
    pub max_results: Option<usize>,
    pub max_file_size: Option<String>,
    pub include_ignored: bool,
}

/// Case-insensitive content search under `scope_path`, capped at
/// `max_results` total hits (50 per file). Gitignore/hidden-file rules apply
/// unless `include_ignored`. Runs off the async runtime via `spawn_blocking`
/// since `ignore`/`grep-searcher` are synchronous.
pub async fn search_with_ripgrep(
    scope_path: &str,
    query: &str,
    opts: &RipgrepOptions,
) -> Vec<SearchContentResult> {
    let scope_path = scope_path.to_string();
    let query = query.to_string();
    let opts = opts.clone();
    tokio::task::spawn_blocking(move || search_blocking(&scope_path, &query, &opts))
        .await
        .unwrap_or_default()
}

fn search_blocking(
    scope_path: &str,
    query: &str,
    opts: &RipgrepOptions,
) -> Vec<SearchContentResult> {
    let matcher = match RegexMatcherBuilder::new()
        .case_insensitive(true)
        .build(query)
    {
        Ok(m) => m,
        Err(err) => {
            tracing::warn!(error = %err, query, "invalid search pattern");
            return Vec::new();
        }
    };
    let max_results = opts.max_results.unwrap_or(DEFAULT_MAX_RESULTS);
    let max_file_size = opts
        .max_file_size
        .as_deref()
        .map(parse_max_file_size)
        .unwrap_or(Some(DEFAULT_MAX_FILE_SIZE));

    let mut builder = WalkBuilder::new(scope_path);
    builder.require_git(false).max_filesize(max_file_size);
    if opts.include_ignored {
        disable_ignore_rules(&mut builder);
    }

    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        .binary_detection(BinaryDetection::quit(0))
        .build();
    let base = Path::new(scope_path);
    let mut results = Vec::new();

    for entry in builder.build() {
        if results.len() >= max_results {
            break;
        }
        let Ok(entry) = entry else { continue };
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }
        let rel_file = relative(base, entry.path());
        let mut sink = ContentSink {
            matcher: &matcher,
            rel_file: &rel_file,
            results: &mut results,
            max_results,
            hits_in_file: 0,
        };
        if let Err(err) = searcher.search_path(&matcher, entry.path(), &mut sink) {
            tracing::warn!(error = %err, file = %entry.path().display(), "content search failed for file");
        }
    }
    results
}

/// Disables every ignore mechanism (`.gitignore`, global/local excludes,
/// hidden-file skip) — mirrors the old CLI's `--no-ignore --hidden`.
fn disable_ignore_rules(builder: &mut WalkBuilder) {
    builder
        .hidden(false)
        .ignore(false)
        .git_ignore(false)
        .git_global(false)
        .git_exclude(false)
        .parents(false);
}

/// Parses the CLI-style `max_file_size` string (`"1M"`, `"512K"`, or a bare
/// byte count) the old code passed straight to `rg --max-filesize`. `None` on
/// empty/unparseable input (the walker then applies no size cap).
fn parse_max_file_size(raw: &str) -> Option<u64> {
    let raw = raw.trim();
    let (digits, multiplier) = match raw.chars().last() {
        Some(c) if c.eq_ignore_ascii_case(&'k') => (&raw[..raw.len() - 1], 1024),
        Some(c) if c.eq_ignore_ascii_case(&'m') => (&raw[..raw.len() - 1], 1024 * 1024),
        Some(c) if c.eq_ignore_ascii_case(&'g') => (&raw[..raw.len() - 1], 1024 * 1024 * 1024),
        _ => (raw, 1),
    };
    digits.trim().parse::<u64>().ok().map(|n| n * multiplier)
}

/// Options for [`list_files_with_ripgrep`].
#[derive(Debug, Clone, Default)]
pub struct ListFilesOptions {
    pub include_ignored: bool,
    pub use_builtin_ignore_only: bool,
}

/// Lists files under `dir_path`, relative to it. `use_builtin_ignore_only`
/// skips `.gitignore` (surfacing gitignored config files like `.env`) but
/// still excludes the project's ignored directories; `include_ignored`
/// disables every ignore rule outright.
pub async fn list_files_with_ripgrep(dir_path: &str, opts: &ListFilesOptions) -> Vec<String> {
    let dir_path = dir_path.to_string();
    let opts = opts.clone();
    tokio::task::spawn_blocking(move || list_files_blocking(&dir_path, &opts))
        .await
        .unwrap_or_default()
}

fn list_files_blocking(dir_path: &str, opts: &ListFilesOptions) -> Vec<String> {
    let mut builder = WalkBuilder::new(dir_path);
    builder.require_git(false);
    if opts.use_builtin_ignore_only {
        disable_ignore_rules(&mut builder);
        // .gitignore is off, so surface gitignored config files — but still
        // skip build-artifact dirs (node_modules, target, ...) by name.
        builder.filter_entry(|entry| {
            entry.depth() == 0
                || entry
                    .file_name()
                    .to_str()
                    .map(|name| !is_ignored_dir(name))
                    .unwrap_or(true)
        });
    } else if opts.include_ignored {
        disable_ignore_rules(&mut builder);
    }

    let base = Path::new(dir_path);
    builder
        .build()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
        .map(|e| relative(base, e.path()))
        .collect()
}

#[cfg(test)]
mod tests;

// PORT STATUS: src/server/ripgrep.ts (parseRipgrepOutput, getRgPath,
// searchWithRipgrep, listFilesWithRipgrep, isRipgrepAvailable)
// confidence: high
// todos: 0
// notes: Rewritten for PR 1 of the Rust-daemon cutover onto ripgrep's own
// library crates (`ignore` + `grep-searcher` + `grep-regex`, pinned to the
// exact versions ripgrep 14.1.1 vendors) instead of shelling out to a resolved
// `rg` binary. Search always runs in-process now, so `isRipgrepAvailable`,
// binary resolution, and `MAINFRAME_RG_PATH` have no successor — every
// caller's "unavailable, fall back to a walk" branch became unreachable and
// was deleted along with it (routes/search.rs's `search_directory_fallback`,
// routes/files.rs's `search_walk`). `--no-require-git` -> `WalkBuilder::
// require_git(false)`; `--no-ignore --hidden` -> `disable_ignore_rules`;
// `--max-count 50` -> the sink's per-file `hits_in_file` cap; `--max-filesize`
// -> `parse_max_file_size` + `WalkBuilder::max_filesize`. Both entry points
// move the synchronous walk/search onto `spawn_blocking` (the daemon forbids
// sync I/O on the async runtime). `line.slice(0,500)` (UTF-16 units) -> first
// 500 chars (UTF-8 safe), same as before.
