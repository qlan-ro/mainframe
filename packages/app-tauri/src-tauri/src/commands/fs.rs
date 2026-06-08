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

/// Returns the current OS: "macos", "windows", or "linux".
#[tauri::command]
pub fn get_platform() -> String {
    std::env::consts::OS.to_string()
}
