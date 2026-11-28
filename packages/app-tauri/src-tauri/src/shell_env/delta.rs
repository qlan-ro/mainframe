//! What a login shell adds to the app's own environment.
//!
//! Only this delta is kept, cached and overlaid on child spawns; everything else
//! comes from the live process env of the launch at hand. That keeps per-boot
//! launchd values (`SSH_AUTH_SOCK`, `SECURITYSESSIONID`, `DISPLAY`) and the
//! variables of whatever terminal started the app (`TERM_SESSION_ID`,
//! `MAINFRAME_*`, `CLAUDECODE`) current, instead of replaying the ones a cached
//! capture saw on an earlier boot or launch.

use super::Env;

/// Keys scoped to a login session, a boot, a terminal or this app's own launch.
/// Never taken from a capture, even when a profile re-exports them.
const SESSION_KEYS: &[&str] = &[
    "_",
    "PWD",
    "OLDPWD",
    "SHLVL",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
    "SSH_CLIENT",
    "SSH_CONNECTION",
    "SSH_TTY",
    "SECURITYSESSIONID",
    "DISPLAY",
    "XAUTHORITY",
    "LaunchInstanceID",
    "Apple_PubSub_Socket_Render",
    "TERM",
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
    "TERM_SESSION_ID",
    "COLORTERM",
    "TMUX",
    "TMUX_PANE",
    "STY",
    "WINDOWID",
    "WT_SESSION",
    "CLAUDECODE",
    "DAEMON_PORT",
];

const SESSION_PREFIXES: &[&str] = &[
    "MAINFRAME_",
    "VITE_DAEMON_",
    "CLAUDE_CODE_",
    "XPC_",
    "__CF",
    "ITERM_",
    "KITTY_",
    "WEZTERM_",
    "GHOSTTY_",
    "ALACRITTY_",
    "VSCODE_",
    "LC_TERMINAL",
    "VTE_",
];

/// Whether `key` is session-, boot- or terminal-scoped and so must never be
/// taken from a (possibly cached) capture.
pub fn is_session_scoped(key: &str) -> bool {
    SESSION_KEYS.contains(&key) || SESSION_PREFIXES.iter().any(|p| key.starts_with(p))
}

/// The keys `captured` adds to or changes in `base`, minus session-scoped keys.
/// `PATH` is always kept (when captured) so the delta states the shell's PATH
/// explicitly even when it equals the base one. Keys the shell removed are
/// ignored: the base value stays.
pub fn shell_delta(captured: &Env, base: &Env) -> Env {
    captured
        .iter()
        .filter(|(key, _)| !is_session_scoped(key))
        .filter(|(key, value)| key.as_str() == "PATH" || base.get(*key) != Some(*value))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

/// `env` without session-scoped keys (for a cache file written elsewhere).
pub fn without_session_keys(env: Env) -> Env {
    env.into_iter()
        .filter(|(key, _)| !is_session_scoped(key))
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

    #[test]
    fn drops_session_and_terminal_scoped_keys_even_when_re_exported() {
        let base = env(&[("SSH_AUTH_SOCK", "/new")]);
        let captured = env(&[
            ("PATH", "/usr/bin"),
            ("SSH_AUTH_SOCK", "/old"),
            ("SECURITYSESSIONID", "186a4"),
            ("DISPLAY", "/private/tmp/xquartz:0"),
            ("TERM_SESSION_ID", "w0t0p0"),
            ("MAINFRAME_MCP_TOKEN", "secret"),
            ("CLAUDECODE", "1"),
            ("CLAUDE_CODE_ENTRYPOINT", "cli"),
            ("ITERM_SESSION_ID", "x"),
            ("SHLVL", "2"),
        ]);

        assert_eq!(shell_delta(&captured, &base), env(&[("PATH", "/usr/bin")]));
    }

    #[test]
    fn ordinary_tool_variables_are_not_session_scoped() {
        for key in [
            "PATH",
            "NVM_DIR",
            "ANTHROPIC_API_KEY",
            "GOPATH",
            "LANG",
            "HOMEBREW_PREFIX",
        ] {
            assert!(!is_session_scoped(key), "{key}");
        }
    }
}
