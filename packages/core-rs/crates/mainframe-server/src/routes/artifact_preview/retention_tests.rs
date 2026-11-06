use super::*;
use std::fs::File;

const DAY: Duration = Duration::from_secs(24 * 60 * 60);
const UNLIMITED: u64 = u64::MAX;

fn now() -> SystemTime {
    SystemTime::now()
}

fn artifact(name: &str, age: Duration, bytes: u64) -> CachedArtifact {
    CachedArtifact {
        dir: PathBuf::from(name),
        last_opened: now() - age,
        bytes,
    }
}

fn names(paths: &[PathBuf]) -> Vec<&str> {
    paths.iter().filter_map(|path| path.to_str()).collect()
}

/// A cached artifact last opened `age` ago.
fn cached(cache: &FsPath, name: &str, age: Duration) -> PathBuf {
    let dir = cache.join(name);
    std::fs::create_dir_all(dir.join("1")).expect("mkdir");
    std::fs::write(dir.join("1").join(META_FILE), "{}").expect("write");
    age_path(&dir.join("1").join(META_FILE), age);
    dir
}

fn age_path(path: &FsPath, age: Duration) {
    File::open(path)
        .expect("open")
        .set_modified(now() - age)
        .expect("set modified");
}

#[test]
fn an_artifact_idle_past_the_limit_is_dropped() {
    let artifacts = vec![
        artifact("old", DAY * 31, 1),
        artifact("recent", DAY * 29, 1),
    ];
    assert_eq!(
        names(&to_evict(artifacts, now(), FsPath::new("x"), UNLIMITED)),
        ["old"]
    );
}

#[test]
fn the_cap_drops_the_oldest_until_the_rest_fit() {
    let artifacts = vec![
        artifact("newest", DAY, 40),
        artifact("oldest", DAY * 3, 40),
        artifact("middle", DAY * 2, 40),
    ];
    assert_eq!(
        names(&to_evict(artifacts, now(), FsPath::new("x"), 50)),
        ["oldest", "middle"]
    );
}

#[test]
fn the_artifact_just_opened_always_stays() {
    let artifacts = vec![artifact("huge", DAY * 40, 1_000)];
    assert!(to_evict(artifacts, now(), FsPath::new("huge"), 10).is_empty());
}

#[test]
fn a_cache_under_its_cap_with_recent_artifacts_is_untouched() {
    let artifacts = vec![artifact("a", DAY, 10), artifact("b", DAY * 2, 10)];
    assert!(to_evict(artifacts, now(), FsPath::new("x"), 100).is_empty());
}

#[tokio::test]
async fn tidying_removes_idle_artifacts_and_abandoned_downloads() {
    let dir = tempfile::tempdir().expect("tempdir");
    let cache = dir.path();
    let old = cached(cache, "old", DAY * 31);
    let recent = cached(cache, "recent", DAY);
    let abandoned = cache.join(".download-1-1");
    let running = cache.join(".download-1-2");
    std::fs::create_dir(&abandoned).expect("mkdir");
    std::fs::create_dir(&running).expect("mkdir");
    age_path(&abandoned, DAY);

    tidy_cache(cache, FsPath::new("none"), now(), UNLIMITED).await;

    assert!(!old.exists());
    assert!(recent.exists());
    assert!(!abandoned.exists());
    assert!(running.exists());
}

#[tokio::test]
async fn sweeping_spares_a_session_that_may_still_be_running() {
    let dir = tempfile::tempdir().expect("tempdir");
    let stale = dir.path().join("stale");
    let live = dir.path().join("live");
    std::fs::create_dir_all(stale.join("scratchpad")).expect("mkdir");
    std::fs::create_dir_all(live.join("scratchpad")).expect("mkdir");
    age_path(&stale, DAY);

    sweep_scratch(dir.path(), now()).await;

    assert!(!stale.exists());
    assert!(live.exists());
}

#[tokio::test]
async fn the_sweep_stays_inside_the_helpers_own_folder() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = std::fs::canonicalize(dir.path()).expect("canonical");
    let cache = root.join("data/artifact-cache");
    let spool = root.join("claude-501");
    std::fs::create_dir_all(&cache).expect("mkdir");
    std::fs::create_dir_all(&spool).expect("mkdir");

    let sessions = helper_sessions(&cache, &spool).await.expect("sessions");

    assert_eq!(sessions.parent(), Some(spool.as_path()));
    assert!(sessions.to_string_lossy().ends_with("-data-artifact-cache"));
}
