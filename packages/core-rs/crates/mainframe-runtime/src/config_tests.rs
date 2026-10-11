use super::*;
use tempfile::tempdir;

#[test]
fn boot_paths_put_database_and_logs_under_configured_data_dir() {
    let config = MainframeConfig {
        data_dir: "/srv/mainframe-data".into(),
        ..default_config()
    };
    let paths = boot_paths(&config, Path::new("/home/dev/.mainframe"));
    assert_eq!(
        paths,
        BootPaths {
            data_dir: PathBuf::from("/srv/mainframe-data"),
            db_path: PathBuf::from("/srv/mainframe-data/mainframe.db"),
            legacy_db_path: PathBuf::from("/home/dev/.mainframe/mainframe.db"),
            log_dir: PathBuf::from("/srv/mainframe-data/logs"),
        }
    );
}

#[test]
fn boot_paths_match_legacy_when_data_dir_is_the_config_dir() {
    let config = MainframeConfig {
        data_dir: "/home/dev/.mainframe".into(),
        ..default_config()
    };
    let paths = boot_paths(&config, Path::new("/home/dev/.mainframe"));
    assert_eq!(
        paths.db_path,
        PathBuf::from("/home/dev/.mainframe/mainframe.db")
    );
    assert_eq!(
        paths.legacy_db_path,
        PathBuf::from("/home/dev/.mainframe/mainframe.db")
    );
    assert_eq!(paths.log_dir, PathBuf::from("/home/dev/.mainframe/logs"));
}

#[test]
fn merge_applies_default_file_then_env() {
    let file = PartialMainframeConfig {
        port: Some(40000),
        auth_secret: Some("from-file".into()),
        ..Default::default()
    };
    let env = PartialMainframeConfig {
        port: Some(41000),
        ..Default::default()
    };
    let merged = merge_config(file, env);
    // env wins over file for port; file-only fields survive.
    assert_eq!(merged.port, 41000);
    assert_eq!(merged.auth_secret.as_deref(), Some("from-file"));
    assert!(merged.data_dir.ends_with(".mainframe"));
}

#[test]
fn merge_treats_blank_data_dir_as_unset() {
    for blank in ["", "   ", "\t\n"] {
        let file = PartialMainframeConfig {
            data_dir: Some(blank.into()),
            ..Default::default()
        };
        let merged = merge_config(file, PartialMainframeConfig::default());
        assert_eq!(PathBuf::from(&merged.data_dir), default_data_dir());
    }

    // A blank file value does not mask the default, and a set env value still wins.
    let file = PartialMainframeConfig {
        data_dir: Some("  ".into()),
        ..Default::default()
    };
    let env = PartialMainframeConfig {
        data_dir: Some("/srv/from-env".into()),
        ..Default::default()
    };
    assert_eq!(merge_config(file, env).data_dir, "/srv/from-env");

    // A blank env value leaves the file's `dataDir` in place.
    let file = PartialMainframeConfig {
        data_dir: Some("/srv/from-file".into()),
        ..Default::default()
    };
    let env = PartialMainframeConfig {
        data_dir: Some(" ".into()),
        ..Default::default()
    };
    assert_eq!(merge_config(file, env).data_dir, "/srv/from-file");
}

#[test]
fn read_file_config_tolerates_missing_and_malformed() {
    let dir = tempdir().unwrap();
    // missing file -> empty partial
    assert!(read_file_config(dir.path()).auth_secret.is_none());
    // malformed json -> empty partial (no propagation)
    fs::write(dir.path().join("config.json"), "{not json").unwrap();
    assert!(read_file_config(dir.path()).port.is_none());
}

#[test]
fn read_file_config_parses_camelcase_fields() {
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join("config.json"),
        r#"{"port":31500,"dataDir":"/tmp/mf","authSecret":"abc","tunnelUrl":"https://x"}"#,
    )
    .unwrap();
    let parsed = read_file_config(dir.path());
    assert_eq!(parsed.port, Some(31500));
    assert_eq!(parsed.data_dir.as_deref(), Some("/tmp/mf"));
    assert_eq!(parsed.auth_secret.as_deref(), Some("abc"));
    assert_eq!(parsed.tunnel_url.as_deref(), Some("https://x"));
}

#[test]
fn save_config_in_round_trips_auth_secret() {
    let dir = tempdir().unwrap();
    let current = default_config();
    save_config_in(
        dir.path(),
        current,
        PartialMainframeConfig {
            auth_secret: Some("deadbeef".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let reloaded = read_file_config(dir.path());
    assert_eq!(reloaded.auth_secret.as_deref(), Some("deadbeef"));
    assert_eq!(reloaded.port, Some(DEFAULT_PORT));
}

#[test]
fn save_config_pretty_prints_two_space_indent() {
    let dir = tempdir().unwrap();
    save_config_in(
        dir.path(),
        default_config(),
        PartialMainframeConfig::default(),
    )
    .unwrap();
    let written = fs::read_to_string(dir.path().join("config.json")).unwrap();
    assert!(
        written.contains("\n  \"port\""),
        "two-space indent: {written}"
    );
    // Optional fields (None) are omitted, matching JSON.stringify.
    assert!(!written.contains("authSecret"));
}

#[test]
fn generate_auth_secret_is_64_hex_chars() {
    let secret = generate_auth_secret();
    assert_eq!(secret.len(), 64);
    assert!(secret.chars().all(|c| c.is_ascii_hexdigit()));
    // Randomness: two calls differ with overwhelming probability.
    assert_ne!(secret, generate_auth_secret());
}
