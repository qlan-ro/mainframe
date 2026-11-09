use super::persist::{clear_tunnel_credentials_in, save_config_in, update_file};
use super::*;
use serde_json::Value;
use std::os::unix::fs::PermissionsExt;
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

fn tunnel_token(token: &str) -> PartialMainframeConfig {
    PartialMainframeConfig {
        tunnel_token: Some(token.into()),
        ..Default::default()
    }
}

fn stored(dir: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(dir.join(CONFIG_FILE)).unwrap()).unwrap()
}

#[test]
fn save_round_trips_and_pretty_prints() {
    let dir = tempdir().unwrap();
    save_config_in(
        dir.path(),
        PartialMainframeConfig {
            auth_secret: Some("deadbeef".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        read_file_config(dir.path()).auth_secret.as_deref(),
        Some("deadbeef")
    );
    let written = fs::read_to_string(dir.path().join(CONFIG_FILE)).unwrap();
    assert_eq!(written, "{\n  \"authSecret\": \"deadbeef\"\n}");
}

#[test]
fn save_touches_only_the_changed_keys() {
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join(CONFIG_FILE),
        r#"{"port":40000,"authSecret":"kept","futureKey":{"nested":true}}"#,
    )
    .unwrap();
    save_config_in(dir.path(), tunnel_token("new")).unwrap();
    assert_eq!(
        stored(dir.path()),
        serde_json::json!({
            "port": 40000,
            "authSecret": "kept",
            "futureKey": { "nested": true },
            "tunnelToken": "new",
        })
    );
}

#[test]
fn clearing_tunnel_credentials_keeps_everything_else() {
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join(CONFIG_FILE),
        r#"{"tunnel":false,"tunnelToken":"t","tunnelUrl":"https://x","authSecret":"kept"}"#,
    )
    .unwrap();
    clear_tunnel_credentials_in(dir.path()).unwrap();
    assert_eq!(
        stored(dir.path()),
        serde_json::json!({ "tunnel": false, "authSecret": "kept" })
    );
}

#[test]
fn saved_file_is_owner_only_even_when_it_was_not() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(CONFIG_FILE);
    fs::write(&path, "{}").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    save_config_in(dir.path(), tunnel_token("t")).unwrap();
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn restricting_an_existing_file_keeps_its_contents_and_tolerates_a_missing_one() {
    let dir = tempdir().unwrap();
    restrict_config_file(dir.path());
    let path = dir.path().join(CONFIG_FILE);
    fs::write(&path, r#"{"authSecret":"s"}"#).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    restrict_config_file(dir.path());
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"authSecret":"s"}"#);
}

fn moved_aside(dir: &Path) -> Vec<Vec<u8>> {
    fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.to_string_lossy().contains("config.json.invalid."))
        .map(|path| fs::read(path).unwrap())
        .collect()
}

#[test]
fn save_moves_an_unparseable_file_aside_instead_of_destroying_it() {
    for content in [
        b"{not json".as_slice(),
        br#"{"port":70000,"authSecret":"only-copy"}"#,
        b"[]",
        b"{\"authSecret\":\"\xff\"}",
    ] {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join(CONFIG_FILE), content).unwrap();
        assert!(read_file_config(dir.path()).auth_secret.is_none());
        save_config_in(dir.path(), tunnel_token("new")).unwrap();
        assert_eq!(moved_aside(dir.path()), [content]);
        assert_eq!(
            stored(dir.path()),
            serde_json::json!({ "tunnelToken": "new" })
        );
    }
}

#[test]
fn concurrent_saves_keep_every_change() {
    let dir = tempdir().unwrap();
    std::thread::scope(|scope| {
        for index in 0..16 {
            let dir = dir.path();
            scope.spawn(move || {
                update_file(dir, |file| {
                    file.insert(format!("key{index}"), index.into());
                })
                .unwrap();
            });
        }
    });
    assert_eq!(stored(dir.path()).as_object().unwrap().len(), 16);
}

#[test]
fn an_empty_secret_counts_as_unset() {
    let secret = |value: &str| Some(value.to_string());
    assert_eq!(
        pick_auth_secret(secret("env"), secret("file")),
        secret("env")
    );
    assert_eq!(pick_auth_secret(secret(""), secret("file")), secret("file"));
    assert_eq!(pick_auth_secret(None, secret("file")), secret("file"));
    assert_eq!(pick_auth_secret(secret(""), secret("")), None);
    assert_eq!(pick_auth_secret(None, secret("")), None);
}

#[test]
fn generate_auth_secret_is_64_hex_chars() {
    let secret = generate_auth_secret();
    assert_eq!(secret.len(), 64);
    assert!(secret.chars().all(|c| c.is_ascii_hexdigit()));
    // Randomness: two calls differ with overwhelming probability.
    assert_ne!(secret, generate_auth_secret());
}
