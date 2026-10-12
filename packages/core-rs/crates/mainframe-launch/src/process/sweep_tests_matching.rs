use super::*;

#[test]
fn binary_matches_the_exact_recorded_path() {
    assert!(process_matches_binary(
        &format!("{BIN} tunnel --url http://localhost:4173"),
        BIN
    ));
}

#[test]
fn binary_rejects_a_non_absolute_recorded_path() {
    assert!(!process_matches_binary(
        "cloudflared tunnel run",
        "cloudflared"
    ));
}

#[test]
fn binary_rejects_a_sibling_sharing_the_path_as_a_prefix() {
    assert!(!process_matches_binary(&format!("{BIN}-updater run"), BIN));
}

#[test]
fn launch_matches_when_full_argv_and_cwd_match() {
    assert!(process_matches_launch(
        Some(&format!("{PNPM} run dev")),
        Some(CWD),
        &launch(1)
    ));
}

#[test]
fn launch_matches_argv_only_invocation_with_matching_cwd() {
    assert!(process_matches_launch(
        Some(PNPM),
        Some(CWD),
        &launch_args(1, vec![], CWD.to_string())
    ));
}

#[test]
fn launch_rejects_when_the_command_line_differs() {
    assert!(!process_matches_launch(
        Some("/usr/bin/postgres -D /data"),
        Some(CWD),
        &launch(1)
    ));
}

#[test]
fn launch_rejects_when_only_a_fragment_of_the_argv_matches() {
    assert!(!process_matches_launch(
        Some(&format!("{PNPM} run dev --host")),
        Some(CWD),
        &launch(1)
    ));
}

#[test]
fn launch_rejects_when_the_cwd_differs() {
    assert!(!process_matches_launch(
        Some(&format!("{PNPM} run dev")),
        Some("/Users/me/other"),
        &launch(1)
    ));
}

#[test]
fn launch_rejects_when_the_live_cwd_is_unreadable() {
    assert!(!process_matches_launch(
        Some(&format!("{PNPM} run dev")),
        None,
        &launch(1)
    ));
}
