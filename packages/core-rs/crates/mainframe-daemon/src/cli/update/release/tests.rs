//! Ported test cases from `packages/core/src/cli/__tests__/update.test.ts`
//! (the `standaloneArtifactName` / `pickRelease` / `assetUrl` / `compareSemver`
//! / `assertNotDowngrade` describe blocks). Expectations are hardcoded, not
//! recomputed from the implementation under test.

use super::*;

fn release(tag: &str, prerelease: bool, asset_names: &[&str]) -> GhRelease {
    GhRelease {
        tag_name: tag.to_string(),
        prerelease,
        draft: false,
        assets: asset_names
            .iter()
            .map(|name| GhAsset {
                name: name.to_string(),
                browser_download_url: format!("https://example.com/{tag}/{name}"),
            })
            .collect(),
    }
}

fn draft_release(tag: &str) -> GhRelease {
    GhRelease {
        draft: true,
        ..release(tag, false, &[])
    }
}

mod standalone_artifact_name_tests {
    use super::*;

    #[test]
    fn maps_supported_platform_arch_pairs_to_the_release_artifact_name() {
        assert_eq!(
            standalone_artifact_name("linux", "x64").unwrap(),
            "mainframe-daemon-linux-x64.tar.gz"
        );
        assert_eq!(
            standalone_artifact_name("linux", "arm64").unwrap(),
            "mainframe-daemon-linux-arm64.tar.gz"
        );
        assert_eq!(
            standalone_artifact_name("darwin", "arm64").unwrap(),
            "mainframe-daemon-darwin-arm64.tar.gz"
        );
    }

    #[test]
    fn rejects_unsupported_platforms() {
        assert!(
            standalone_artifact_name("win32", "x64")
                .unwrap_err()
                .contains("Unsupported platform")
        );
        assert!(
            standalone_artifact_name("linux", "ia32")
                .unwrap_err()
                .contains("Unsupported platform")
        );
    }
}

mod pick_release_tests {
    use super::*;

    fn list() -> Vec<GhRelease> {
        vec![
            release("v2.1.0-rc.1", true, &[]),
            release("v2.0.0", false, &[]),
            release("v1.9.0", false, &[]),
        ]
    }

    #[test]
    fn defaults_to_the_newest_stable_release_skipping_pre_releases() {
        assert_eq!(
            pick_release(&list(), None, false).unwrap().tag_name,
            "v2.0.0"
        );
    }

    #[test]
    fn picks_the_newest_pre_release_when_pre_is_set() {
        assert_eq!(
            pick_release(&list(), None, true).unwrap().tag_name,
            "v2.1.0-rc.1"
        );
    }

    #[test]
    fn selects_an_explicit_version_with_or_without_a_leading_v() {
        assert_eq!(
            pick_release(&list(), Some("v1.9.0"), false)
                .unwrap()
                .tag_name,
            "v1.9.0"
        );
        assert_eq!(
            pick_release(&list(), Some("1.9.0"), false)
                .unwrap()
                .tag_name,
            "v1.9.0"
        );
    }

    #[test]
    fn ignores_draft_releases() {
        let with_draft = vec![draft_release("v3.0.0"), release("v2.0.0", false, &[])];
        assert_eq!(
            pick_release(&with_draft, None, false).unwrap().tag_name,
            "v2.0.0"
        );
    }

    #[test]
    fn hints_at_pre_when_only_pre_releases_exist() {
        let only_pre = vec![release("v2.0.0-rc.1", true, &[])];
        assert!(
            pick_release(&only_pre, None, false)
                .unwrap_err()
                .contains("mainframe update --pre")
        );
    }

    #[test]
    fn throws_for_an_unknown_explicit_version() {
        assert!(
            pick_release(&list(), Some("v9.9.9"), false)
                .unwrap_err()
                .contains("No release found for version")
        );
    }
}

mod asset_url_tests {
    use super::*;

    #[test]
    fn returns_the_download_url_for_a_matching_asset() {
        let r = release("v2.0.0", false, &["mainframe-daemon-linux-x64.tar.gz"]);
        assert_eq!(
            asset_url(&r, "mainframe-daemon-linux-x64.tar.gz").unwrap(),
            "https://example.com/v2.0.0/mainframe-daemon-linux-x64.tar.gz"
        );
    }

    #[test]
    fn throws_when_the_artifact_is_absent_from_the_release() {
        let r = release("v2.0.0", false, &["mainframe-daemon-darwin-arm64.tar.gz"]);
        assert!(
            asset_url(&r, "mainframe-daemon-linux-x64.tar.gz")
                .unwrap_err()
                .contains("does not include")
        );
    }
}

mod compare_semver_tests {
    use super::*;

    #[test]
    fn compares_major_minor_and_patch_numerically() {
        assert!(compare_semver("2.0.0", "1.9.9") > 0);
        assert!(compare_semver("1.2.0", "1.10.0") < 0);
        assert_eq!(compare_semver("1.2.3", "1.2.3"), 0);
    }

    #[test]
    fn ranks_a_release_above_a_prerelease_of_the_same_core_version() {
        assert!(compare_semver("2.0.0", "2.0.0-rc.8") > 0);
        assert!(compare_semver("2.0.0-rc.8", "2.0.0") < 0);
    }

    #[test]
    fn ranks_a_prerelease_of_a_higher_core_version_above_an_older_stable_release() {
        assert!(compare_semver("v2.0.0-rc.8", "v1.0.0") > 0);
    }

    #[test]
    fn compares_prerelease_identifiers_numerically_when_both_sides_are_numeric() {
        assert!(compare_semver("2.0.0-rc.9", "2.0.0-rc.10") < 0);
    }

    #[test]
    fn tolerates_a_leading_v_on_either_side() {
        assert_eq!(compare_semver("v1.0.0", "1.0.0"), 0);
    }
}

mod assert_not_downgrade_tests {
    use super::*;

    #[test]
    fn allows_installing_a_strictly_newer_release() {
        assert!(assert_not_downgrade(&release("v2.0.0-rc.8", true, &[]), "1.0.0", false).is_ok());
    }

    #[test]
    fn refuses_to_install_a_release_that_is_not_newer_than_the_running_version() {
        let err =
            assert_not_downgrade(&release("v1.0.0", false, &[]), "2.0.0-rc.6", false).unwrap_err();
        assert!(err.contains("not newer than the running version"));
    }

    #[test]
    fn refuses_to_install_the_same_release_again() {
        let err = assert_not_downgrade(&release("v1.0.0", false, &[]), "1.0.0", false).unwrap_err();
        assert!(err.contains("not newer than the running version"));
    }

    #[test]
    fn allows_a_downgrade_when_force_is_set() {
        assert!(assert_not_downgrade(&release("v1.0.0", false, &[]), "2.0.0-rc.6", true).is_ok());
    }
}
