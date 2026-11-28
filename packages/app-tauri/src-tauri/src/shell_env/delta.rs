//! What a login shell adds to the app's own environment.
//!
//! Only this delta is kept, cached and overlaid on child spawns; everything else
//! comes from the live process env of the launch at hand. Values the app
//! inherits from launchd or a terminal (`SSH_AUTH_SOCK`, `SECURITYSESSIONID`,
//! `TERM_SESSION_ID`, …) reach the capture unchanged, so they are not part of
//! the delta and never replay from an older cache. Values the profile sets on
//! purpose (`SSH_AUTH_SOCK` for 1Password or gpg-agent, `CLAUDE_CODE_USE_BEDROCK`)
//! differ from the inherited ones, so they are kept.

use super::Env;

/// Keys the capture itself changes (`env` runs one shell level down, in its
/// own working directory) and keys the app owns for its daemon. Never taken
/// from a capture.
const NEVER_CACHED_KEYS: &[&str] = &["_", "PWD", "OLDPWD", "SHLVL", "DAEMON_PORT"];

const NEVER_CACHED_PREFIXES: &[&str] = &["MAINFRAME_", "VITE_DAEMON_"];

/// Whether `key` is set by the capture itself or owned by the app, and so must
/// never be taken from a (possibly cached) capture.
pub fn is_never_cached(key: &str) -> bool {
    NEVER_CACHED_KEYS.contains(&key) || NEVER_CACHED_PREFIXES.iter().any(|p| key.starts_with(p))
}

/// The keys `captured` adds to or changes in `base`, minus [`is_never_cached`]
/// keys. `PATH` is always kept (when captured) so the delta states the shell's
/// PATH explicitly even when it equals the base one. Keys the shell removed are
/// ignored: the base value stays.
pub fn shell_delta(captured: &Env, base: &Env) -> Env {
    captured
        .iter()
        .filter(|(key, _)| !is_never_cached(key))
        .filter(|(key, value)| key.as_str() == "PATH" || base.get(*key) != Some(*value))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

/// `env` without [`is_never_cached`] keys (for a cache file written elsewhere).
pub fn without_never_cached(env: Env) -> Env {
    env.into_iter()
        .filter(|(key, _)| !is_never_cached(key))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Env {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn keeps_what_the_shell_added_or_changed() {
        let base = env(&[("PATH", "/usr/bin"), ("HOME", "/h"), ("LANG", "C")]);
        let captured = env(&[
            ("PATH", "/opt/homebrew/bin:/usr/bin"),
            ("HOME", "/h"),
            ("LANG", "en_US.UTF-8"),
            ("NVM_DIR", "/h/.nvm"),
        ]);

        assert_eq!(
            shell_delta(&captured, &base),
            env(&[
                ("PATH", "/opt/homebrew/bin:/usr/bin"),
                ("LANG", "en_US.UTF-8"),
                ("NVM_DIR", "/h/.nvm")
            ])
        );
    }

    #[test]
    fn always_keeps_path_even_when_unchanged() {
        let base = env(&[("PATH", "/usr/bin")]);
        assert_eq!(shell_delta(&base, &base), env(&[("PATH", "/usr/bin")]));
    }

    /// Inherited launchd and terminal values pass through the shell unchanged,
    /// so the delta drops them without any denylist.
    #[test]
    fn inherited_session_values_are_not_part_of_the_delta() {
        let inherited = [
            (
                "SSH_AUTH_SOCK",
                "/private/tmp/com.apple.launchd.x/Listeners",
            ),
            ("SECURITYSESSIONID", "186a4"),
            ("DISPLAY", "/private/tmp/xquartz:0"),
            ("TERM_SESSION_ID", "w0t0p0"),
            ("CLAUDECODE", "1"),
        ];
        let base = env(&inherited);
        let mut captured = env(&inherited);
        captured.insert("PATH".into(), "/usr/bin".into());

        assert_eq!(shell_delta(&captured, &base), env(&[("PATH", "/usr/bin")]));
    }

    #[test]
    fn values_the_profile_sets_on_purpose_are_kept() {
        let base = env(&[(
            "SSH_AUTH_SOCK",
            "/private/tmp/com.apple.launchd.x/Listeners",
        )]);
        let captured = env(&[
            ("PATH", "/usr/bin"),
            ("SSH_AUTH_SOCK", "/h/.1password/agent.sock"),
            ("CLAUDE_CODE_USE_BEDROCK", "1"),
            ("CLAUDE_CODE_OAUTH_TOKEN", "token"),
        ]);

        let delta = shell_delta(&captured, &base);
        assert_eq!(delta["SSH_AUTH_SOCK"], "/h/.1password/agent.sock");
        assert_eq!(delta["CLAUDE_CODE_USE_BEDROCK"], "1");
        assert_eq!(delta["CLAUDE_CODE_OAUTH_TOKEN"], "token");
    }

    #[test]
    fn capture_made_and_app_owned_keys_are_never_cached() {
        let captured = env(&[
            ("PATH", "/usr/bin"),
            ("SHLVL", "2"),
            ("PWD", "/h"),
            ("OLDPWD", "/"),
            ("_", "/usr/bin/env"),
            ("MAINFRAME_MCP_TOKEN", "secret"),
            ("DAEMON_PORT", "31416"),
            ("VITE_DAEMON_HTTP_PORT", "31416"),
        ]);

        assert_eq!(
            shell_delta(&captured, &Env::new()),
            env(&[("PATH", "/usr/bin")])
        );
    }

    #[test]
    fn tool_and_auth_variables_are_cacheable() {
        for key in [
            "PATH",
            "NVM_DIR",
            "ANTHROPIC_API_KEY",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "SSH_AUTH_SOCK",
            "GOPATH",
            "LANG",
        ] {
            assert!(!is_never_cached(key), "{key}");
        }
    }
}
