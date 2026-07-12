//! Ported from `packages/core/src/db/__tests__/devices.test.ts`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::rc::Rc;

use rusqlite::Connection;

use mainframe_db::DevicesRepository;

fn setup() -> DevicesRepository {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS devices (
            device_id   TEXT PRIMARY KEY,
            device_name TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            last_seen   TEXT,
            auth_epoch  INTEGER NOT NULL DEFAULT 0
        )",
    )
    .unwrap();
    DevicesRepository::new(Rc::new(conn))
}

#[test]
fn adds_and_retrieves_a_device() {
    let devices = setup();
    devices.add("mobile-1", "My iPhone").unwrap();
    let all = devices.get_all().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].device_id, "mobile-1");
    assert_eq!(all[0].device_name, "My iPhone");
    assert!(!all[0].created_at.is_empty());
}

#[test]
fn removes_a_device() {
    let devices = setup();
    devices.add("mobile-1", "My iPhone").unwrap();
    devices.remove("mobile-1").unwrap();
    assert_eq!(devices.get_all().unwrap().len(), 0);
}

#[test]
fn updates_last_seen() {
    let devices = setup();
    devices.add("mobile-1", "My iPhone").unwrap();
    devices.update_last_seen("mobile-1").unwrap();
    let all = devices.get_all().unwrap();
    assert!(all[0].last_seen.as_deref().is_some_and(|s| !s.is_empty()));
}

#[test]
fn returns_empty_array_when_no_devices() {
    let devices = setup();
    assert_eq!(devices.get_all().unwrap().len(), 0);
}

#[test]
fn preserves_created_at_on_re_add() {
    let devices = setup();
    devices.add("mobile-1", "My iPhone").unwrap();
    let first = devices.get_all().unwrap()[0].created_at.clone();
    devices.add("mobile-1", "Renamed iPhone").unwrap();
    let second = devices.get_all().unwrap()[0].clone();
    assert_eq!(second.created_at, first);
    assert_eq!(second.device_name, "Renamed iPhone");
}

#[test]
fn find_by_device_id_returns_null_for_unknown_device() {
    let devices = setup();
    assert!(devices.find_by_device_id("nope").unwrap().is_none());
}

#[test]
fn find_by_device_id_returns_device_with_auth_epoch() {
    let devices = setup();
    devices.add("mobile-1", "My iPhone").unwrap();
    let row = devices.find_by_device_id("mobile-1").unwrap();
    assert!(row.is_some());
    let row = row.unwrap();
    assert_eq!(row.device.device_id, "mobile-1");
    assert_eq!(row.auth_epoch, 0);
}

#[test]
fn increment_auth_epoch_atomically_bumps_and_returns_new_value() {
    let devices = setup();
    devices.add("mobile-1", "My iPhone").unwrap();
    assert_eq!(devices.increment_auth_epoch("mobile-1").unwrap(), 1);
    assert_eq!(devices.increment_auth_epoch("mobile-1").unwrap(), 2);
    assert_eq!(
        devices
            .find_by_device_id("mobile-1")
            .unwrap()
            .unwrap()
            .auth_epoch,
        2
    );
}

#[test]
fn increment_auth_epoch_returns_0_for_unknown_device() {
    let devices = setup();
    assert_eq!(devices.increment_auth_epoch("ghost").unwrap(), 0);
}
