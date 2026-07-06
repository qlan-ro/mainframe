//! Port of packages/app-electron/src/main/auto-updater-error-classifier.ts.
//! Transient errors (network/5xx/429/rate-limit) are suppressed from the UI;
//! persistent errors surface. Plan 3, decision 1.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum UpdateErrorKind {
    Transient,
    Persistent,
}

const TRANSIENT_CODES: &[&str] = &[
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENETUNREACH",
    "EHOSTUNREACH",
];
const PERSISTENT_CODES: &[&str] = &["ENOSPC", "EPERM", "EACCES"];

pub fn classify(message: &str) -> UpdateErrorKind {
    for code in TRANSIENT_CODES {
        if message.contains(code) {
            return UpdateErrorKind::Transient;
        }
    }
    for code in PERSISTENT_CODES {
        if message.contains(code) {
            return UpdateErrorKind::Persistent;
        }
    }
    let lower = message.to_lowercase();
    // HTTP 5xx / 429 / GitHub 403 rate-limit / generic network strings.
    let transient_markers = [
        "status 5",
        "status 429",
        "net::err_",
        "network unavailable",
        "network is unavailable",
        "dns lookup fail",
        "dns fail",
    ];
    if transient_markers.iter().any(|m| lower.contains(m)) {
        return UpdateErrorKind::Transient;
    }
    if lower.contains("status 403") && lower.contains("api.github.com") {
        return UpdateErrorKind::Transient;
    }
    UpdateErrorKind::Persistent
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_codes_are_transient() {
        assert_eq!(
            classify("getaddrinfo ENOTFOUND github.com"),
            UpdateErrorKind::Transient
        );
        assert_eq!(
            classify("connect ECONNREFUSED"),
            UpdateErrorKind::Transient
        );
    }

    #[test]
    fn disk_perm_codes_are_persistent() {
        assert_eq!(classify("write ENOSPC"), UpdateErrorKind::Persistent);
        assert_eq!(
            classify("EACCES: permission denied"),
            UpdateErrorKind::Persistent
        );
    }

    #[test]
    fn http_5xx_and_429_are_transient() {
        assert_eq!(
            classify("Server responded with status 503"),
            UpdateErrorKind::Transient
        );
        assert_eq!(
            classify("HTTP status 429 Too Many Requests"),
            UpdateErrorKind::Transient
        );
    }

    #[test]
    fn github_403_rate_limit_is_transient() {
        assert_eq!(
            classify("status 403 from api.github.com rate limit exceeded"),
            UpdateErrorKind::Transient
        );
    }

    #[test]
    fn unknown_is_persistent() {
        assert_eq!(
            classify("signature verification failed"),
            UpdateErrorKind::Persistent
        );
    }
}
