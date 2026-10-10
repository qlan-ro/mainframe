use super::*;

#[test]
fn clean_env_uses_orig_path_and_does_not_forward_it() {
    let source: HashMap<String, String> = [
        ("PATH", "/mainframe/bundled/bin:/usr/bin"),
        ("MAINFRAME_ORIG_PATH", "/usr/bin:/usr/local/bin"),
        ("HOME", "/home/u"),
        ("ELECTRON_RUN_AS_NODE", "1"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    let env = clean_env(&source);
    assert_eq!(
        env.get("PATH").map(String::as_str),
        Some("/usr/bin:/usr/local/bin")
    );
    assert_eq!(env.get("MAINFRAME_ORIG_PATH"), None);
    assert_eq!(env.get("HOME").map(String::as_str), Some("/home/u"));
    // Non-allowlisted daemon vars are dropped.
    assert_eq!(env.get("ELECTRON_RUN_AS_NODE"), None);
}

#[test]
fn clean_env_falls_back_to_daemon_path_when_orig_unset() {
    let source: HashMap<String, String> = [("PATH", "/usr/bin:/usr/local/bin")]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    let env = clean_env(&source);
    assert_eq!(
        env.get("PATH").map(String::as_str),
        Some("/usr/bin:/usr/local/bin")
    );
}

#[test]
fn clean_env_forwards_lc_and_lang_prefixes() {
    let source: HashMap<String, String> =
        [("LC_ALL", "C"), ("LANG", "en_US.UTF-8"), ("NPM_TOKEN", "x")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
    let env = clean_env(&source);
    assert_eq!(env.get("LC_ALL").map(String::as_str), Some("C"));
    assert_eq!(env.get("LANG").map(String::as_str), Some("en_US.UTF-8"));
    assert_eq!(env.get("NPM_TOKEN"), None);
}

#[test]
fn compose_injects_resolved_path_when_orig_absent() {
    let source = env_source(&[("PATH", "/mainframe/bundled/bin:/usr/bin")]);
    let env = compose_launch_env(source, Some("/opt/homebrew/bin:/usr/bin"));
    assert_eq!(
        env.get("PATH").map(String::as_str),
        Some("/opt/homebrew/bin:/usr/bin")
    );
}

#[test]
fn compose_orig_path_overrides_injected_resolved_path() {
    let source = env_source(&[
        ("PATH", "/mainframe/bundled/bin:/usr/bin"),
        ("MAINFRAME_ORIG_PATH", "/usr/bin:/usr/local/bin"),
    ]);
    let env = compose_launch_env(source, Some("/opt/homebrew/bin:/usr/bin"));
    // The standalone contract wins even when a resolved PATH is injected.
    assert_eq!(
        env.get("PATH").map(String::as_str),
        Some("/usr/bin:/usr/local/bin")
    );
    assert_eq!(env.get("MAINFRAME_ORIG_PATH"), None);
}

#[test]
fn compose_inherits_daemon_path_when_no_resolved_path() {
    let source = env_source(&[("PATH", "/usr/bin:/usr/local/bin")]);
    let env = compose_launch_env(source, None);
    assert_eq!(
        env.get("PATH").map(String::as_str),
        Some("/usr/bin:/usr/local/bin")
    );
}
