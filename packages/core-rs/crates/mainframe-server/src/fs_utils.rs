//! Ported from `src/server/fs-utils.ts`.
//!
//! Shared filesystem helpers for the file/search routes: the ignored-directory
//! and binary-extension deny lists, the `hasBinaryExtension` double-extension
//! check, and `listProjectFiles` (git `ls-files` primary, symlink-contained walk
//! fallback). Also hosts two Node-`path` shims (`relative`, `path_resolve`) the
//! route handlers lean on, since the std library has no direct analogue.

use std::path::{Component, Path, PathBuf};

use mainframe_git::{GitExecCode, exec_git};

/// Directories skipped by the project walk and excluded from ripgrep `--files`
/// globs. Mirrors the TS `IGNORED_DIRS` set (order preserved for the glob build).
pub const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    "out",
    ".cache",
    "__pycache__",
    ".venv",
    "vendor",
    "coverage",
    ".turbo",
    ".gradle",
    ".cargo",
    "target",
    ".parcel-cache",
    ".nuxt",
    ".output",
    "bower_components",
    ".worktrees",
    "worktrees",
    ".worktree",
    "Pods",
    "DerivedData",
    ".build",
    "Carthage",
    ".idea",
    ".vscode",
    ".vs",
    ".fleet",
    ".zed",
];

/// Extensions treated as binary (never surfaced in the file picker / content
/// search). Includes the double-extension forms `.min.js`, `.min.css`, `.map`.
pub const BINARY_EXTENSIONS: &[&str] = &[
    // Compiled code / native binaries
    ".class", ".jar", ".war", ".o", ".a", ".so", ".dylib", ".dll", ".exe", ".bin", ".pyc", ".pyo",
    ".wasm", ".node", // Build/bundler output
    ".min.js", ".min.css", ".map", // Images
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".avif", ".bmp", ".tiff", ".tif",
    ".heic", ".heif", ".psd", ".ai", ".sketch", ".fig", ".xcf", // Fonts
    ".woff", ".woff2", ".ttf", ".otf", ".ttc", ".eot", // Audio / video
    ".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a", ".mp4", ".mov", ".avi", ".mkv", ".webm",
    ".m4v", ".wmv", // Archives
    ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".zst", ".rar", ".7z", // Documents
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", // Disk / installer images
    ".dmg", ".iso", ".deb", ".rpm", ".pkg", ".msi", ".apk", ".ipa", // Databases
    ".sqlite", ".sqlite3", ".db",
];

const WALK_LIMIT: usize = 10_000;

/// True when `name` is one of the ignored directory names.
pub fn is_ignored_dir(name: &str) -> bool {
    IGNORED_DIRS.contains(&name)
}

/// Mirrors `hasBinaryExtension`: checks the double-extension (`.min.js`) first
/// (slice from the first dot), then Node's `path.extname` (from the last dot).
pub fn has_binary_extension(file_path: &str) -> bool {
    let base = Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_path.to_string());

    if let Some(dot_index) = base.find('.') {
        let double_ext = &base[dot_index..];
        if BINARY_EXTENSIONS.contains(&double_ext) {
            return true;
        }
    }
    let ext = extname(&base);
    !ext.is_empty() && BINARY_EXTENSIONS.contains(&ext)
}

/// Node `path.extname`: the substring from the last dot in the segment, or `""`
/// when there is no dot or the only dot is the leading one (e.g. `.env` → `""`).
fn extname(base: &str) -> &str {
    match base.rfind('.') {
        None | Some(0) => "",
        Some(i) => &base[i..],
    }
}

/// Node `path.relative(from, to)` over absolute, normalized paths: the shared
/// prefix is dropped, remaining `from` components become `..`, then the `to`
/// tail is appended. Used to re-base absolute paths to project-relative ones.
pub fn relative(from: &Path, to: &Path) -> String {
    let from_comps: Vec<Component<'_>> = from.components().collect();
    let to_comps: Vec<Component<'_>> = to.components().collect();
    let mut i = 0;
    while i < from_comps.len() && i < to_comps.len() && from_comps[i] == to_comps[i] {
        i += 1;
    }
    let mut out = PathBuf::new();
    for _ in i..from_comps.len() {
        out.push("..");
    }
    for c in &to_comps[i..] {
        out.push(c.as_os_str());
    }
    out.to_string_lossy().into_owned()
}

/// Node `path.resolve(base, requested)` (lexical, no filesystem access): an
/// absolute `requested` replaces `base`; otherwise they are joined; then `.`/`..`
/// segments are collapsed. Used only as the best-effort fallback in
/// `paths/resolve` when `realpath` fails.
pub fn path_resolve(base: &str, requested: &str) -> String {
    let joined = if Path::new(requested).is_absolute() {
        PathBuf::from(requested)
    } else {
        Path::new(base).join(requested)
    };
    let mut out: Vec<Component<'_>> = Vec::new();
    for comp in joined.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(out.last(), Some(Component::Normal(_))) {
                    out.pop();
                } else if !matches!(
                    out.last(),
                    Some(Component::RootDir) | Some(Component::Prefix(_))
                ) {
                    out.push(comp);
                }
            }
            other => out.push(other),
        }
    }
    let mut buf = PathBuf::new();
    for c in out {
        buf.push(c.as_os_str());
    }
    buf.to_string_lossy().into_owned()
}

/// Mirrors `listProjectFiles`: with `include_ignored`, walk everything (build
/// artifacts included); otherwise ask git for tracked + untracked-not-ignored
/// files, falling back to the ignored-dir-skipping walk when git fails.
pub async fn list_project_files(project_path: &str, include_ignored: bool) -> Vec<String> {
    if include_ignored {
        return walk_project_files(project_path, false).await;
    }

    let args = [
        "ls-files".to_string(),
        "--cached".to_string(),
        "--others".to_string(),
        "--exclude-standard".to_string(),
    ];
    match exec_git(&args, project_path, None).await {
        Ok(output) => output
            .split('\n')
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect(),
        Err(err) => {
            // Exit 128 = "not a git repo"; anything else is unexpected — log it,
            // then fall back to the walk either way.
            if err.code != Some(GitExecCode::Number(128)) {
                tracing::warn!(error = %err, project_path, "git ls-files failed unexpectedly, falling back to walk");
            }
            walk_project_files(project_path, true).await
        }
    }
}

/// Recursive project walk with a hard `WALK_LIMIT`. Each entry is realpath'd and
/// confirmed inside `project_path` (symlink containment); `.git` is always
/// skipped, other ignored dirs only when `skip_ignored_dirs`.
async fn walk_project_files(project_path: &str, skip_ignored_dirs: bool) -> Vec<String> {
    let root = Path::new(project_path);
    let mut files: Vec<String> = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        if files.len() >= WALK_LIMIT {
            break;
        }
        let mut read_dir = match tokio::fs::read_dir(&dir).await {
            Ok(rd) => rd,
            Err(err) => {
                tracing::warn!(error = %err, dir = %dir.display(), "Failed to read directory during project walk");
                continue;
            }
        };
        while let Ok(Some(entry)) = read_dir.next_entry().await {
            if files.len() >= WALK_LIMIT {
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == ".git" {
                continue;
            }
            if skip_ignored_dirs && is_ignored_dir(&name) {
                continue;
            }
            let full_path = entry.path();
            // Symlink safety: resolve and verify within the project root.
            let real_full = match tokio::fs::canonicalize(&full_path).await {
                Ok(p) => p,
                Err(_) => continue,
            };
            if !crate::path_utils::is_within_base(root, &real_full) {
                continue;
            }
            let is_dir = match entry.file_type().await {
                Ok(ft) if ft.is_symlink() => tokio::fs::metadata(&full_path)
                    .await
                    .map(|m| m.is_dir())
                    .unwrap_or(false),
                Ok(ft) => ft.is_dir(),
                Err(_) => continue,
            };
            if is_dir {
                stack.push(full_path);
            } else {
                files.push(relative(root, &real_full));
            }
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_extension_matches_simple_and_double_extensions() {
        assert!(has_binary_extension("logo.png"));
        assert!(has_binary_extension("src/app.min.js"));
        assert!(has_binary_extension("styles.min.css"));
        assert!(has_binary_extension("bundle.js.map"));
        assert!(!has_binary_extension("index.ts"));
        assert!(!has_binary_extension("README"));
        assert!(!has_binary_extension(".env"));
    }

    #[test]
    fn relative_drops_shared_prefix_and_climbs() {
        assert_eq!(relative(Path::new("/a/b"), Path::new("/a/b/c/d")), "c/d");
        assert_eq!(relative(Path::new("/a/b"), Path::new("/a/x")), "../x");
        assert_eq!(relative(Path::new("/a/b"), Path::new("/a/b")), "");
    }

    #[test]
    fn path_resolve_collapses_dot_segments() {
        assert_eq!(path_resolve("/a/b", "c/../d"), "/a/b/d");
        assert_eq!(path_resolve("/a/b", "../e"), "/a/e");
        assert_eq!(path_resolve("/a/b", "/x/y"), "/x/y");
    }

    #[tokio::test]
    async fn walk_collects_files_and_skips_ignored_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "x").unwrap();
        std::fs::create_dir_all(tmp.path().join("node_modules")).unwrap();
        std::fs::write(tmp.path().join("node_modules/dep.js"), "y").unwrap();
        std::fs::create_dir_all(tmp.path().join("src")).unwrap();
        std::fs::write(tmp.path().join("src/index.ts"), "z").unwrap();

        // Callers pass a realpath'd base (macOS /tmp → /private/tmp); mirror that.
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let files = walk_project_files(&root.to_string_lossy(), true).await;
        assert!(files.iter().any(|f| f == "a.txt"));
        assert!(files.iter().any(|f| f == "src/index.ts"));
        assert!(!files.iter().any(|f| f.contains("node_modules")));
    }
}

// PORT STATUS: src/server/fs-utils.ts (IGNORED_DIRS, BINARY_EXTENSIONS,
// hasBinaryExtension, listProjectFiles/walkProjectFiles)
// confidence: high
// todos: 0
// notes: Node `readdir(withFileTypes)` → `tokio::fs::read_dir`; the recursive
// `walk` is expressed iteratively with an explicit stack (no async-recursion
// boxing) — pre-order vs stack order is unobservable (no route asserts walk
// ordering; the git `ls-files` primary path preserves git's own order). Symlink
// containment reuses `path_utils::is_within_base` (the sep-guarded prefix check,
// equivalent to TS `realFull.startsWith(projectPath + sep)`). `git ls-files`
// via `mainframe_git::exec_git`; non-128 errors log then fall back to the walk,
// matching the TS `code !== 128` branch. `relative`/`path_resolve` are Node
// `path` shims added here (std has no analogue) for the route handlers.
