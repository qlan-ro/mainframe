//! Fake login shells and scratch directories for the env-boot tests.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static NEXT: AtomicU32 = AtomicU32::new(0);

/// A fresh, empty directory unique to this process and call.
pub fn scratch_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "mf-shell-env-{tag}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Write an executable stand-in for `$SHELL` into `dir`. Invoked as
/// `<shell> -lic env`, it ignores its arguments, sleeps `sleep_secs`, then
/// prints `env_lines` (newline-separated `KEY=VALUE`).
pub fn fake_shell(dir: &Path, sleep_secs: u32, env_lines: &str) -> PathBuf {
    let path = dir.join(format!(
        "fake-shell-{}",
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let script = format!("#!/bin/sh\nsleep {sleep_secs}\ncat <<'MF_EOF'\n{env_lines}\nMF_EOF\n");
    std::fs::write(&path, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    path
}

/// A fake shell that exits non-zero without printing anything.
pub fn failing_shell(dir: &Path) -> PathBuf {
    let path = dir.join("failing-shell");
    std::fs::write(&path, "#!/bin/sh\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    path
}
