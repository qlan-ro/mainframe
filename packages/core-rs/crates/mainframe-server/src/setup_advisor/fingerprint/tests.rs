//! Tests for project fingerprinting: the rich-fixture happy path, one case per
//! `tooling` detection, Claude-config detection, and the near-empty fixture.
//! Git-host classification and file-walk behavior live in the sibling
//! `git_tests` and `walk_tests` modules — see those for symlink containment,
//! the worktree case, and the walk cap.

use super::*;
use mainframe_types::setup_advisor::GitHost;
use std::fs;
use tempfile::tempdir;

mod git_tests;
mod walk_tests;

/// Writes each `(relative_path, contents)` pair into `root`, creating parent
/// dirs as needed.
fn write_files(root: &Path, files: &[(&str, &str)]) {
    for (path, contents) in files {
        let full = root.join(path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(full, contents).unwrap();
    }
}

#[tokio::test]
async fn fingerprints_a_rich_nextjs_project_with_git_env_and_tooling() {
    let tmp = tempdir().unwrap();
    write_files(
        tmp.path(),
        &[
            (
                "package.json",
                r#"{
                    "dependencies": {
                        "next": "14.0.0",
                        "react": "18.2.0",
                        "@supabase/supabase-js": "2.0.0"
                    }
                }"#,
            ),
            (".prettierrc", "{}"),
            ("tsconfig.json", "{}"),
            ("docker-compose.yml", "services: {}"),
            (".env.example", "API_KEY="),
            ("pnpm-lock.yaml", "lockfileVersion: '6.0'"),
            ("tests/placeholder.txt", ""),
            (
                ".git/config",
                "[remote \"origin\"]\n\turl = git@github.com:acme/app.git\n",
            ),
        ],
    );

    let fp = fingerprint(tmp.path()).await;

    assert!(fp.tooling.contains(&"prettier".to_string()));
    assert!(fp.tooling.contains(&"tsconfig".to_string()));
    assert!(fp.tooling.contains(&"docker".to_string()));
    assert!(fp.dirs.contains(&"tests".to_string()));
    assert!(fp.has_env_files);
    assert!(fp.has_lock_files);
    assert_eq!(fp.git_host, Some(GitHost::Github));
}

#[tokio::test]
async fn detects_eslint_from_a_flat_config_file() {
    let tmp = tempdir().unwrap();
    write_files(tmp.path(), &[("eslint.config.js", "module.exports = {};")]);
    let fp = fingerprint(tmp.path()).await;
    assert!(fp.tooling.contains(&"eslint".to_string()));
}

#[tokio::test]
async fn detects_eslint_from_a_legacy_rc_file() {
    let tmp = tempdir().unwrap();
    write_files(tmp.path(), &[(".eslintrc.json", "{}")]);
    let fp = fingerprint(tmp.path()).await;
    assert!(fp.tooling.contains(&"eslint".to_string()));
}

#[tokio::test]
async fn detects_ruff_from_its_config_file() {
    let tmp = tempdir().unwrap();
    write_files(tmp.path(), &[("ruff.toml", "")]);
    let fp = fingerprint(tmp.path()).await;
    assert!(fp.tooling.contains(&"ruff".to_string()));
}

#[tokio::test]
async fn detects_jest_from_its_config_file() {
    let tmp = tempdir().unwrap();
    write_files(tmp.path(), &[("jest.config.ts", "export default {};")]);
    let fp = fingerprint(tmp.path()).await;
    assert!(fp.tooling.contains(&"jest".to_string()));
}

#[tokio::test]
async fn detects_pytest_from_its_ini_file() {
    let tmp = tempdir().unwrap();
    write_files(tmp.path(), &[("pytest.ini", "[pytest]")]);
    let fp = fingerprint(tmp.path()).await;
    assert!(fp.tooling.contains(&"pytest".to_string()));
}

#[tokio::test]
async fn detects_docker_from_a_bare_dockerfile_with_no_compose_file() {
    let tmp = tempdir().unwrap();
    write_files(tmp.path(), &[("Dockerfile", "FROM node:22")]);
    let fp = fingerprint(tmp.path()).await;
    assert!(fp.tooling.contains(&"docker".to_string()));
}

#[tokio::test]
async fn claude_config_is_detected_from_a_dot_claude_directory() {
    let tmp = tempdir().unwrap();
    write_files(tmp.path(), &[(".claude/settings.json", "{}")]);
    let fp = fingerprint(tmp.path()).await;
    assert!(fp.has_claude_config);
}

#[tokio::test]
async fn claude_config_is_detected_from_a_claude_md_file() {
    let tmp = tempdir().unwrap();
    write_files(tmp.path(), &[("CLAUDE.md", "# Notes")]);
    let fp = fingerprint(tmp.path()).await;
    assert!(fp.has_claude_config);
}

#[tokio::test]
async fn a_near_empty_project_with_no_manifest_yields_few_signals() {
    let tmp = tempdir().unwrap();
    write_files(tmp.path(), &[("main.py", "print('hi')")]);
    let fp = fingerprint(tmp.path()).await;
    assert!(fp.signals.len() < 3);
}
