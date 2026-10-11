use super::*;
use std::sync::Mutex;

fn recording(
    f: impl Fn(&str) -> bool + Send + Sync + 'static,
) -> (IsExecutableFn, Arc<Mutex<Vec<String>>>) {
    let seen = Arc::new(Mutex::new(vec![]));
    let sink = seen.clone();
    let is_exec: IsExecutableFn = Arc::new(move |candidate: String| {
        sink.lock().unwrap().push(candidate.clone());
        let result = f(&candidate);
        Box::pin(async move { result })
    });
    (is_exec, seen)
}

#[tokio::test]
async fn returns_the_first_path_entry_that_holds_an_executable_cloudflared() {
    let (is_executable, _seen) = recording(|p| p == "/opt/homebrew/bin/cloudflared");
    let result = resolve_cloudflared_path(ResolveCloudflaredDeps {
        path: Some("/usr/bin:/opt/homebrew/bin:/sbin".to_string()),
        platform: Some("darwin".to_string()),
        is_executable: Some(is_executable),
    })
    .await;
    assert_eq!(result.as_deref(), Some("/opt/homebrew/bin/cloudflared"));
}

#[tokio::test]
async fn prefers_earlier_path_entries() {
    let (is_executable, _seen) = recording(|_| true);
    let result = resolve_cloudflared_path(ResolveCloudflaredDeps {
        path: Some("/home/user/.mainframe/bin/bin:/opt/homebrew/bin".to_string()),
        platform: Some("linux".to_string()),
        is_executable: Some(is_executable),
    })
    .await;
    assert_eq!(
        result.as_deref(),
        Some("/home/user/.mainframe/bin/bin/cloudflared")
    );
}

#[tokio::test]
async fn returns_none_when_cloudflared_is_not_found() {
    let (is_executable, _seen) = recording(|_| false);
    let result = resolve_cloudflared_path(ResolveCloudflaredDeps {
        path: Some("/usr/bin:/bin".to_string()),
        platform: Some("darwin".to_string()),
        is_executable: Some(is_executable),
    })
    .await;
    assert_eq!(result, None);
}

#[tokio::test]
async fn looks_for_cloudflared_exe_on_win32() {
    let (is_executable, seen) = recording(|_| false);
    resolve_cloudflared_path(ResolveCloudflaredDeps {
        path: Some("C:\\bin;C:\\tools".to_string()),
        platform: Some("win32".to_string()),
        is_executable: Some(is_executable),
    })
    .await;
    let seen = seen.lock().unwrap();
    assert!(!seen.is_empty());
    assert!(seen.iter().all(|p| p.ends_with("cloudflared.exe")));
}

#[tokio::test]
async fn ignores_empty_path_segments_without_probing_them() {
    let (is_executable, seen) = recording(|_| false);
    resolve_cloudflared_path(ResolveCloudflaredDeps {
        path: Some("::/usr/bin:".to_string()),
        platform: Some("linux".to_string()),
        is_executable: Some(is_executable),
    })
    .await;
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0], "/usr/bin/cloudflared");
}
