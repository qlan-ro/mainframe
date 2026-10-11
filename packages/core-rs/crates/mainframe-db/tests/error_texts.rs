#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

//! Golden texts and status classes for the `DbError`s REST routes answer with.
//! The tag route returns these messages verbatim, so the strings are wire
//! contract.

use mainframe_db::{DatabaseManager, DbError};
use mainframe_types::chat::NO_PROJECT_ID;
use mainframe_types::http_status::{HttpStatus, StatusKind};
use mainframe_types::tags::TagColor;

fn db() -> DatabaseManager {
    DatabaseManager::open(std::path::Path::new(":memory:")).unwrap()
}

fn text_and_kind(err: DbError) -> (String, StatusKind) {
    (err.to_string(), err.status_kind())
}

#[test]
fn an_invalid_tag_name_is_a_bad_request_with_the_validator_text() {
    let err = db().tags.upsert("a", None).unwrap_err();
    assert_eq!(
        text_and_kind(err),
        (
            "Tag name too short (min 2 chars).".to_string(),
            StatusKind::BadRequest
        )
    );
    let err = db().tags.rename("rust", "Not Valid!").unwrap_err();
    assert_eq!(
        text_and_kind(err),
        (
            "Tag name must use lowercase letters, numbers, or hyphens only.".to_string(),
            StatusKind::BadRequest
        )
    );
}

#[test]
fn a_missing_tag_is_not_found() {
    let err = db().tags.set_color("ghost", TagColor::Red).unwrap_err();
    assert_eq!(
        text_and_kind(err),
        ("Tag not found: ghost".to_string(), StatusKind::NotFound)
    );
    let err = db().tags.remove("ghost").unwrap_err();
    assert_eq!(
        text_and_kind(err),
        ("Tag not found: ghost".to_string(), StatusKind::NotFound)
    );
}

#[test]
fn removing_the_scratch_project_is_a_bad_request() {
    let err = db().projects.remove(NO_PROJECT_ID).unwrap_err();
    assert_eq!(
        text_and_kind(err),
        (
            "cannot remove the hidden scratch project".to_string(),
            StatusKind::BadRequest
        )
    );
}

#[test]
fn a_worker_failure_keeps_its_text_and_is_internal() {
    assert_eq!(
        text_and_kind(DbError::Worker("unavailable")),
        (
            "database worker unavailable".to_string(),
            StatusKind::Internal
        )
    );
}
