use std::path::Path;

/// Validates that `path` canonicalizes to somewhere under the user home dir.
fn validate_under_home(path: &str) -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot determine home directory".to_string())?;
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("cannot resolve path '{}': {e}", path))?;
    if !canonical.starts_with(&home) {
        return Err(format!("path '{}' is outside the home directory", path));
    }
    Ok(canonical)
}

/// Reveal `path` in the system file manager:
///   macOS  → `open -R <path>`
///   Windows → `explorer /select,<path>`
///   Linux   → `xdg-open <parent-dir>`
#[tauri::command]
pub fn show_item_in_folder(path: String) -> Result<(), String> {
    let canonical = validate_under_home(&path)?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&canonical)
            .spawn()
            .map_err(|e| format!("open -R failed: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", canonical.display()))
            .spawn()
            .map_err(|e| format!("explorer failed: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = canonical
            .parent()
            .unwrap_or(Path::new("/"))
            .to_string_lossy()
            .to_string();
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| format!("xdg-open failed: {e}"))?;
    }

    Ok(())
}

/// Open the file at `path` with its default application (an `.html` file opens
/// in the default browser, a `.pdf` in the PDF reader):
///   macOS  → `open <path>`
///   Windows → `explorer <path>`
///   Linux   → `xdg-open <path>`
///
/// Only regular, non-executable files are opened: a directory (macOS `.app`
/// bundles are directories) or a file with an exec bit would launch a program.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let canonical = validate_under_home(&path)?;
    ensure_openable_file(&canonical)?;

    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "linux")]
    let program = "xdg-open";

    std::process::Command::new(program)
        .arg(&canonical)
        .spawn()
        .map_err(|e| format!("{program} failed: {e}"))?;
    Ok(())
}

/// Rejects anything `open_path` must not hand to the OS launcher: directories
/// and files with an exec bit.
fn ensure_openable_file(path: &Path) -> Result<(), String> {
    let meta =
        std::fs::metadata(path).map_err(|e| format!("cannot stat '{}': {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("'{}' is not a regular file", path.display()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 != 0 {
            return Err(format!(
                "refusing to open executable file '{}'",
                path.display()
            ));
        }
    }
    Ok(())
}

/// Read a text file from disk. Path must canonicalize under the home directory.
/// Returns `None` if the file doesn't exist or is outside home.
// `async` so Tauri runs these on the async runtime instead of the main/UI
// thread — a multi-MB read won't stall the webview.
#[tauri::command]
pub async fn read_file(path: String) -> Result<Option<String>, String> {
    let canonical = match validate_under_home(&path) {
        Ok(p) => p,
        Err(_) => return Ok(None), // doesn't exist or outside home → safe None
    };
    match std::fs::read_to_string(&canonical) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read_file '{}': {e}", path)),
    }
}

/// Read a binary file from disk and return its contents as a base64-encoded
/// string. Path must canonicalize under the home directory.
/// Returns `None` if the file doesn't exist or is outside home.
/// Used by the image and PDF viewers which cannot use the text `read_file`.
#[tauri::command]
pub async fn read_file_base64(path: String) -> Result<Option<String>, String> {
    let canonical = match validate_under_home(&path) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    match std::fs::read(&canonical) {
        Ok(bytes) => Ok(Some(base64_encode(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read_file_base64 '{}': {e}", path)),
    }
}

/// Minimal base64 encoder (RFC 4648, no line wrapping). Avoids adding a crate.
fn base64_encode(input: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        out.push(CHARS[(b0 >> 2) & 0x3f]);
        out.push(CHARS[((b0 << 4) | (b1 >> 4)) & 0x3f]);
        out.push(if chunk.len() > 1 { CHARS[((b1 << 2) | (b2 >> 6)) & 0x3f] } else { b'=' });
        out.push(if chunk.len() > 2 { CHARS[b2 & 0x3f] } else { b'=' });
    }
    // SAFETY: only ASCII chars from CHARS table
    unsafe { String::from_utf8_unchecked(out) }
}

/// Returns the current OS: "macos", "windows", or "linux".
#[tauri::command]
pub fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[cfg(test)]
mod tests {
    use super::ensure_openable_file;

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mf-open-path-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_a_regular_file() {
        let dir = scratch_dir("regular");
        let file = dir.join("page.html");
        std::fs::write(&file, "<h1>hi</h1>").unwrap();
        assert!(ensure_openable_file(&file).is_ok());
    }

    #[test]
    fn rejects_a_directory() {
        let dir = scratch_dir("dir");
        let bundle = dir.join("Evil.app");
        std::fs::create_dir_all(&bundle).unwrap();
        let err = ensure_openable_file(&bundle).unwrap_err();
        assert!(err.contains("not a regular file"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_an_executable_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch_dir("exec");
        let script = dir.join("run.command");
        std::fs::write(&script, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let err = ensure_openable_file(&script).unwrap_err();
        assert!(err.contains("executable"));
    }

    #[test]
    fn rejects_a_missing_path() {
        let dir = scratch_dir("missing");
        assert!(ensure_openable_file(&dir.join("nope.html")).is_err());
    }
}
