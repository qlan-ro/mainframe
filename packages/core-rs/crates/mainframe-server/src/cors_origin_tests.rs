use super::is_allowed_origin;

#[test]
fn allows_http_localhost_with_a_dev_vite_port() {
    assert!(is_allowed_origin(Some("http://localhost:5174")));
}

#[test]
fn allows_http_localhost_with_the_daemon_port() {
    assert!(is_allowed_origin(Some("http://localhost:31500")));
}

#[test]
fn allows_http_127_with_a_port() {
    assert!(is_allowed_origin(Some("http://127.0.0.1:31500")));
}

#[test]
fn allows_https_localhost_with_a_port() {
    assert!(is_allowed_origin(Some("https://localhost:5174")));
}

#[test]
fn allows_http_localhost_with_no_port() {
    assert!(is_allowed_origin(Some("http://localhost")));
}

#[test]
fn allows_the_packaged_tauri_macos_linux_custom_scheme_origin() {
    assert!(is_allowed_origin(Some("tauri://localhost")));
}

#[test]
fn allows_the_packaged_tauri_windows_http_origin() {
    assert!(is_allowed_origin(Some("http://tauri.localhost")));
}

#[test]
fn allows_the_packaged_tauri_windows_https_origin() {
    assert!(is_allowed_origin(Some("https://tauri.localhost")));
}

#[test]
fn rejects_an_undefined_origin() {
    assert!(!is_allowed_origin(None));
}

#[test]
fn rejects_an_empty_string_origin() {
    assert!(!is_allowed_origin(Some("")));
}

#[test]
fn rejects_an_unrelated_external_origin() {
    assert!(!is_allowed_origin(Some("http://evil.com")));
}

#[test]
fn rejects_an_https_external_origin() {
    assert!(!is_allowed_origin(Some("https://example.com")));
}

#[test]
fn rejects_a_domain_that_merely_starts_with_localhost() {
    assert!(!is_allowed_origin(Some("http://localhost.evil.com")));
}

#[test]
fn rejects_a_domain_that_merely_starts_with_127() {
    assert!(!is_allowed_origin(Some("http://127.0.0.1.evil.com")));
}

#[test]
fn rejects_a_tauri_scheme_with_a_non_localhost_host() {
    assert!(!is_allowed_origin(Some("tauri://evil")));
}

#[test]
fn rejects_the_literal_null_origin_sent_by_file_contexts() {
    assert!(!is_allowed_origin(Some("null")));
}
