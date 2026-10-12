//! Collects the Claude context files (`CLAUDE.md`/`AGENTS.md`) that apply to a
//! session — user-global under `~/.claude` (as ABSOLUTE paths so the daemon's
//! GET /files route whitelists them and can tell a global file from a same-named
//! project one) plus the project-scoped ones. `home_dir` is injectable so the
//! global path is testable without reading the real home directory.

use std::path::{Path, PathBuf};

use mainframe_adapter_api::ContextFiles;
use mainframe_types::context::{ContextFile, ContextFileSource};

const CONTEXT_FILE_NAMES: [&str; 2] = ["CLAUDE.md", "AGENTS.md"];

pub(crate) fn collect_claude_context_files(
    project_path: &str,
    home_dir: Option<&Path>,
) -> ContextFiles {
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
#[path = "context_files_tests.rs"]
mod tests;
