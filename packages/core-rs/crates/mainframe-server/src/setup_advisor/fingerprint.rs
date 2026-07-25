//! Walks a project root and assembles its `ProjectFingerprint`.

use std::path::Path;

use mainframe_types::setup_advisor::ProjectFingerprint;

use crate::fs_utils::walk_project_files;

use super::git_host::detect_git_host;
use super::manifests::detect_root_manifests;
use super::signals::build_signals;

/// Where the file walk stops. `fileCount` is a size hint for the report, not a
/// census, so a cap costs nothing and bounds the walk on a monorepo.
pub(super) const FILE_COUNT_CAP: usize = 5_000;

/// Tool label to the root entry-name prefixes that identify it. Prefixes cover
/// both the config-file families (`.prettierrc`, `.prettierrc.json`) and the
/// suffixed forms (`Dockerfile.dev`). Table order is the output order.
const TOOLING: &[(&str, &[&str])] = &[
    ("prettier", &[".prettierrc", "prettier.config."]),
    ("eslint", &[".eslintrc", "eslint.config."]),
    ("tsconfig", &["tsconfig.json"]),
    ("tailwind", &["tailwind.config."]),
    ("jest", &["jest.config."]),
    ("pytest", &["pytest.ini"]),
    ("ruff", &["ruff.toml"]),
    (
        "docker",
        &["Dockerfile", "docker-compose.yml", "docker-compose.yaml"],
    ),
];

/// Root directories worth reporting, in output order.
const PROJECT_DIRS: &[&str] = &["src", "app", "components", "tests", "api"];

const LOCK_FILES: &[&str] = &[
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "Cargo.lock",
    "poetry.lock",
    "uv.lock",
    "go.sum",
    "Gemfile.lock",
    "composer.lock",
];

/// One `read_dir` pass over the root, as `(name, is_dir)`. Every root-level
/// detection reads off this list instead of re-statting each candidate name.
async fn root_entries(real_root: &Path) -> Vec<(String, bool)> {
    let mut read_dir = match tokio::fs::read_dir(real_root).await {
        Ok(rd) => rd,
        Err(err) => {
            tracing::warn!(error = %err, "setup advisor: project root is unreadable");
            return Vec::new();
        }
    };
    let mut entries = Vec::new();
    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let is_dir = entry
            .file_type()
            .await
            .map(|kind| kind.is_dir())
            .unwrap_or(false);
        entries.push((entry.file_name().to_string_lossy().into_owned(), is_dir));
    }
    entries
}

/// Fills the presence-derived fields (tooling, dirs, env/lock/Claude config)
/// from the root listing.
fn apply_root_entries(fp: &mut ProjectFingerprint, entries: &[(String, bool)]) {
    let names: Vec<&str> = entries.iter().map(|(name, _)| name.as_str()).collect();

    for (label, prefixes) in TOOLING {
        if names
            .iter()
            .any(|name| prefixes.iter().any(|prefix| name.starts_with(prefix)))
        {
            fp.tooling.push((*label).to_string());
        }
    }
    for dir in PROJECT_DIRS {
        if entries.iter().any(|(name, is_dir)| *is_dir && name == dir) {
            fp.dirs.push((*dir).to_string());
        }
    }
    fp.has_env_files = names.iter().any(|name| name.starts_with(".env"));
    fp.has_lock_files = names.iter().any(|name| LOCK_FILES.contains(name));
    fp.has_claude_config = entries
        .iter()
        .any(|(name, is_dir)| name == "CLAUDE.md" || (*is_dir && name == ".claude"));
}

/// Fingerprints the project rooted at `root`.
///
/// Takes only a root so todo #192 can import it standalone; it knows nothing
/// about recommendations. Read-only: no writes, no subprocesses.
pub async fn fingerprint(root: &Path) -> ProjectFingerprint {
    let mut fp = ProjectFingerprint::default();
    // Canonicalize once at the entry point: every containment check below
    // compares against this base, and a symlinked root (macOS `/var` →
    // `/private/var`) would otherwise fail all of them.
    let real_root = match tokio::fs::canonicalize(root).await {
        Ok(path) => path,
        Err(err) => {
            tracing::warn!(error = %err, "setup advisor: project root does not resolve");
            return fp;
        }
    };

    detect_root_manifests(&real_root, &mut fp).await;
    apply_root_entries(&mut fp, &root_entries(&real_root).await);
    fp.git_host = detect_git_host(&real_root).await;
    fp.file_count = walk_project_files(&real_root.to_string_lossy(), true, FILE_COUNT_CAP)
        .await
        .len() as u64;
    fp.signals = build_signals(&fp);
    fp
}

#[cfg(test)]
mod tests;
