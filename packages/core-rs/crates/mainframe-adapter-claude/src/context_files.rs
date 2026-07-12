//! Ported from `packages/core/src/plugins/builtin/claude/context-files.ts`.
//!
//! Collects the Claude context files (`CLAUDE.md`/`AGENTS.md`) that apply to a
//! session — user-global under `~/.claude` (as ABSOLUTE paths so the daemon's
//! GET /files route whitelists them and can tell a global file from a same-named
//! project one) plus the project-scoped ones. `home_dir` is injectable so the
//! global path is testable without reading the real home directory.

use std::path::{Path, PathBuf};

use mainframe_adapter_api::ContextFiles;
use mainframe_types::context::{ContextFile, ContextFileSource};

const CONTEXT_FILE_NAMES: [&str; 2] = ["CLAUDE.md", "AGENTS.md"];

pub fn collect_claude_context_files(project_path: &str, home_dir: Option<&Path>) -> ContextFiles {
    let home: PathBuf = match home_dir {
        Some(h) => h.to_path_buf(),
        None => dirs::home_dir().unwrap_or_default(),
    };

    let mut global: Vec<ContextFile> = Vec::new();
    let global_dir = home.join(".claude");
    for name in CONTEXT_FILE_NAMES {
        let abs = global_dir.join(name);
        if let Some(content) = read_if_present(&abs) {
            // Absolute path (not a `~`-prefixed string): the daemon's GET /files
            // route whitelists absolute paths under ~/.claude, and it distinguishes
            // a global CLAUDE.md from a same-named project one — the UI never
            // expands `~` (#222).
            global.push(ContextFile {
                path: abs.to_string_lossy().to_string(),
                content,
                source: ContextFileSource::Global,
            });
        }
    }

    let mut project: Vec<ContextFile> = Vec::new();
    let base = Path::new(project_path);
    for name in CONTEXT_FILE_NAMES {
        for dir in [base.to_path_buf(), base.join(".claude")] {
            let abs = dir.join(name);
            if let Some(content) = read_if_present(&abs) {
                let rel = abs
                    .strip_prefix(base)
                    .map(|r| r.to_string_lossy().to_string())
                    .unwrap_or_else(|_| abs.to_string_lossy().to_string());
                project.push(ContextFile {
                    path: rel,
                    content,
                    source: ContextFileSource::Project,
                });
            }
        }
    }

    ContextFiles { global, project }
}

fn read_if_present(abs: &Path) -> Option<String> {
    if !abs.exists() {
        return None;
    }
    // expected: unreadable file (perms/race) — skip it.
    std::fs::read_to_string(abs).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Translated assertion-for-assertion from claude/__tests__/context-files.test.ts.

    #[test]
    fn reports_the_global_claude_md_as_an_absolute_claude_path() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".claude")).unwrap();
        std::fs::write(
            home.path().join(".claude").join("CLAUDE.md"),
            "global rules",
        )
        .unwrap();
        let proj = tempfile::tempdir().unwrap();

        let files = collect_claude_context_files(proj.path().to_str().unwrap(), Some(home.path()));

        assert_eq!(
            files.global,
            vec![ContextFile {
                path: home
                    .path()
                    .join(".claude")
                    .join("CLAUDE.md")
                    .to_string_lossy()
                    .to_string(),
                content: "global rules".to_string(),
                source: ContextFileSource::Global,
            }]
        );
    }

    #[test]
    fn reports_project_files_with_project_relative_paths() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("CLAUDE.md"), "root").unwrap();
        std::fs::create_dir_all(project.path().join(".claude")).unwrap();
        std::fs::write(project.path().join(".claude").join("AGENTS.md"), "nested").unwrap();
        let home = tempfile::tempdir().unwrap();

        let files =
            collect_claude_context_files(project.path().to_str().unwrap(), Some(home.path()));

        assert_eq!(
            files.project,
            vec![
                ContextFile {
                    path: "CLAUDE.md".to_string(),
                    content: "root".to_string(),
                    source: ContextFileSource::Project,
                },
                ContextFile {
                    path: Path::new(".claude")
                        .join("AGENTS.md")
                        .to_string_lossy()
                        .to_string(),
                    content: "nested".to_string(),
                    source: ContextFileSource::Project,
                },
            ]
        );
    }

    #[test]
    fn omits_files_that_do_not_exist() {
        let proj = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let files = collect_claude_context_files(proj.path().to_str().unwrap(), Some(home.path()));
        assert!(files.global.is_empty());
        assert!(files.project.is_empty());
    }
}

// PORT STATUS: src/plugins/builtin/claude/context-files.ts (53 lines)
// confidence: high
// todos: 0
// notes: Main catch-up (#432). Global files now carry the ABSOLUTE ~/.claude path
// notes: (was a bare name in the old inline session.rs version) so GET /files can
// notes: whitelist + disambiguate them. home_dir injectable (Option<&Path>, None →
// notes: dirs::home_dir) for testability. Sync std::fs mirrors the TS existsSync/
// notes: readFileSync (this is a sync getContextFiles path, as in session.rs).
// notes: Returns mainframe_adapter_api::ContextFiles (the { global, project } shape).
// notes: context-files.test.ts translated (relative path assertion built with
// notes: Path::join so it matches the platform separator).
