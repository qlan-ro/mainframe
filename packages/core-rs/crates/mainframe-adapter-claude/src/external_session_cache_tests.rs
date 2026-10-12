use super::*;

fn meta() -> ExternalSession {
    ExternalSession {
        session_id: "a".to_string(),
        adapter_id: "claude".to_string(),
        project_path: "/p".to_string(),
        cwd: None,
        first_prompt: None,
        title: None,
        summary: None,
        message_count: None,
        created_at: "x".to_string(),
        modified_at: "x".to_string(),
        git_branch: None,
        model: None,
    }
}

#[test]
fn returns_cached_meta_for_same_mtime_size() {
    let cache = new_external_session_cache();
    set_cached(&cache, "a", 100.0, 50, meta());
    assert_eq!(get_cached(&cache, "a", 100.0, 50), Some(meta()));
}

#[test]
fn misses_when_mtime_changes() {
    let cache = new_external_session_cache();
    set_cached(&cache, "a", 100.0, 50, meta());
    assert_eq!(get_cached(&cache, "a", 200.0, 50), None);
}

#[test]
fn misses_when_size_changes() {
    let cache = new_external_session_cache();
    set_cached(&cache, "a", 100.0, 50, meta());
    assert_eq!(get_cached(&cache, "a", 100.0, 99), None);
}

#[test]
fn clear_empties_the_cache() {
    let cache = new_external_session_cache();
    set_cached(&cache, "a", 100.0, 50, meta());
    clear_external_session_cache(&cache);
    assert_eq!(get_cached(&cache, "a", 100.0, 50), None);
}

#[test]
fn cached_session_write_survives_a_poisoned_lock() {
    let cache = new_external_session_cache();
    std::thread::scope(|scope| {
        assert!(
            scope
                .spawn(|| {
                    let _guard = cache.lock().unwrap();
                    panic!("poison external session cache");
                })
                .join()
                .is_err()
        );
    });

    set_cached(&cache, "a", 100.0, 50, meta());
    assert_eq!(get_cached(&cache, "a", 100.0, 50), Some(meta()));
    clear_external_session_cache(&cache);
    assert_eq!(get_cached(&cache, "a", 100.0, 50), None);
}
