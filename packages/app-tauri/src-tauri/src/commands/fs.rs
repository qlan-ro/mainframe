#[allow(unused_imports)]
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

/// Read a text file from disk. Path must canonicalize under the home directory.
/// Returns `None` if the file doesn't exist or is outside home.
#[tauri::command]
pub fn read_file(path: String) -> Result<Option<String>, String> {
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
pub fn read_file_base64(path: String) -> Result<Option<String>, String> {
    let canonical = match validate_under_home(&path) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    match std::fs::read(&canonical) {
        Ok(bytes) => {
            use std::io::Write;
            // Use the base64 alphabet shipped with the standard library via
            // std::io::Write on a Vec — no extra crate needed; encode manually.
            Ok(Some(base64_encode(&bytes)))
        }
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
