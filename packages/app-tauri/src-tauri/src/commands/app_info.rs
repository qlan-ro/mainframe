use tauri::AppHandle;

#[derive(serde::Serialize)]
pub struct AppInfo {
    pub version: String,
    pub author: String,
    pub homedir: String,
}

#[tauri::command]
pub fn get_app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        author: "Mainframe Contributors".to_string(),
        homedir: dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    }
}

#[tauri::command]
pub fn get_homedir() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}
