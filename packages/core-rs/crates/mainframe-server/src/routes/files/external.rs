use super::*;

pub(super) async fn read_external_file(resolved: &str, is_base64: bool) -> Response {
    match tokio::fs::read(&resolved).await {
        Ok(bytes) => {
            if is_base64 {
                ok(
                    serde_json::json!({ "path": resolved, "content": mainframe_types::base64_data::encode(&bytes), "encoding": "base64" }),
                )
            } else {
                ok(
                    serde_json::json!({ "path": resolved, "content": String::from_utf8_lossy(&bytes) }),
                )
            }
        }
        Err(err) => crate::respond::fail_internal(
            format!("Failed to read external file path={}", resolved),
            &err,
            "Failed to read file",
        ),
    }
}

pub(super) async fn validate_external_file(
    resolved: &str,
    is_base64: bool,
) -> Result<(), Box<Response>> {
    let Ok(meta) = tokio::fs::metadata(&resolved).await else {
        tracing::warn!(path = resolved, "Failed to stat external file");
        return Err(Box::new(fail(StatusCode::NOT_FOUND, "File not found")));
    };
    if !meta.is_file() {
        return Err(Box::new(fail(
            StatusCode::BAD_REQUEST,
            "Path is not a file",
        )));
    }
    // Same limits as the project files route: binary viewers need more headroom.
    let max_mb: u64 = if is_base64 { 10 } else { 2 };
    if meta.len() > max_mb * 1024 * 1024 {
        return Err(Box::new(fail(
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("File too large (max {max_mb}MB)"),
        )));
    }
    Ok(())
}
