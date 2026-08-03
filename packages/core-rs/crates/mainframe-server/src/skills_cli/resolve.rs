//! Binary resolution for the `skills` CLI: search `PATH` for an executable
//! `skills` file, falling back to `npx` (which will run `npx skills …`), or
//! `None` when neither resolves.

use std::os::unix::fs::PermissionsExt;

use mainframe_runtime::ResolvedPath;

/// The resolved CLI invocation: `program` plus any leading argv the package
/// runner needs (`npx` prepends `"skills"`; the real binary needs none).
#[derive(Debug, Clone)]
pub struct CliBinary {
    pub program: String,
    pub prefix: Vec<String>,
}

/// Sync by design: a bounded stat-walk over `PATH`'s handful of entries,
/// called once per operation — not the daemon's per-request I/O path that
/// the "no sync I/O" rule targets (mirrors `ResolvedPath::resolve`'s
/// documented boot-time exception).
pub fn resolve_cli(path: &ResolvedPath) -> Option<CliBinary> {
    if is_on_path(path, "skills") {
        return Some(CliBinary {
            program: "skills".to_string(),
            prefix: Vec::new(),
        });
    }
    is_on_path(path, "npx").then(|| CliBinary {
        program: "npx".to_string(),
        prefix: vec!["skills".to_string()],
    })
}

/// Bare-name existence check — `program` stays the bare name (not the
/// resolved absolute path) since `run.rs` re-`env("PATH", …)`s the spawn and
/// lets the OS re-resolve it, matching how every other spawn site in this
/// crate invokes tools found on `PATH`.
fn is_on_path(path: &ResolvedPath, name: &str) -> bool {
    path.as_str().split(':').any(|dir| {
        if dir.is_empty() {
            return false;
        }
        let candidate = std::path::Path::new(dir).join(name);
        std::fs::metadata(&candidate)
            .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
    })
}
