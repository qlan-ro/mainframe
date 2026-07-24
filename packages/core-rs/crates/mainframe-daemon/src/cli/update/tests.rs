//! Ported test cases from `packages/core/src/cli/__tests__/update.test.ts`
//! (the `parseUpdateArgs` / `resolveInstallRoot` describe blocks). The install
//! marker differs from the TS twin (`bin/mainframe-daemon`, not
//! `lib/daemon.cjs`) because the standalone layout no longer bundles Node.

use super::*;

mod parse_update_args_tests {
    use super::*;

    #[test]
    fn parses_flags_and_their_values() {
        assert_eq!(
            parse_update_args(&["--pre".to_string()]).unwrap(),
            UpdateOptions {
                include_prerelease: true,
                ..Default::default()
            }
        );
        assert_eq!(
            parse_update_args(&["--version".to_string(), "v2.0.0-rc.1".to_string()]).unwrap(),
            UpdateOptions {
                version: Some("v2.0.0-rc.1".to_string()),
                ..Default::default()
            }
        );
        assert_eq!(
            parse_update_args(&["--dir".to_string(), "/opt/mf".to_string()]).unwrap(),
            UpdateOptions {
                dir: Some("/opt/mf".to_string()),
                ..Default::default()
            }
        );
        assert_eq!(
            parse_update_args(&["--force".to_string()]).unwrap(),
            UpdateOptions {
                force: true,
                ..Default::default()
            }
        );
        assert_eq!(
            parse_update_args(&["--help".to_string()]).unwrap(),
            UpdateOptions {
                help: true,
                ..Default::default()
            }
        );
    }

    #[test]
    fn rejects_unknown_arguments() {
        let err = parse_update_args(&["--nope".to_string()]).unwrap_err();
        assert!(err.contains("Unknown argument"));
    }
}

mod resolve_install_root_tests {
    use super::*;

    fn standalone_layout() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("bin")).unwrap();
        std::fs::write(
            root.path().join("bin").join("mainframe-daemon"),
            b"#!/bin/sh\n",
        )
        .unwrap();
        root
    }

    #[test]
    fn uses_mainframe_standalone_root_when_it_points_at_a_real_install() {
        let root = standalone_layout();
        let mut env = HashMap::new();
        env.insert(
            "MAINFRAME_STANDALONE_ROOT".to_string(),
            root.path().display().to_string(),
        );
        assert_eq!(
            resolve_install_root(&env, Path::new("/usr/bin/mainframe-daemon")).unwrap(),
            root.path()
        );
    }

    #[test]
    fn falls_back_to_deriving_the_root_from_the_running_binary_path() {
        let root = standalone_layout();
        let exe = root.path().join("bin").join("mainframe-daemon");
        assert_eq!(
            resolve_install_root(&HashMap::new(), &exe).unwrap(),
            root.path()
        );
    }

    #[test]
    fn errors_with_install_script_guidance_when_no_standalone_layout_is_found() {
        let err = resolve_install_root(&HashMap::new(), Path::new("/usr/bin/mainframe-daemon"))
            .unwrap_err();
        assert!(err.contains("install script"));
    }
}
