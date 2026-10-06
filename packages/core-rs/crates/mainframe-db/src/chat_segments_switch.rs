//! Applies a planned provider switch (`SwitchCommit`): segment and native-row
//! changes, then the chat's settings and the session mirror, all inside the
//! caller's transaction.

use mainframe_types::segment::{OpenNative, SwitchCommit, SwitchSettings};
use rusqlite::Connection;

use crate::chat_native_sessions as natives;
use crate::chat_segments::insert_segment;
use crate::{DbError, enum_to_db_string};

pub(crate) fn apply(db: &Connection, commit: &SwitchCommit) -> Result<(), DbError> {
    if let Some(conversion) = &commit.borrow_pinned {
        crate::chat_segments_fork::borrow_pinned(db, conversion)?;
    }
    if let Some(pending) = &commit.delete_pending {
        db.execute(
            "DELETE FROM chat_segments WHERE id = ? AND chat_id = ? AND closed_at IS NULL",
            rusqlite::params![pending.segment_id, commit.chat_id],
        )?;
        if let Some(native_ref) = &pending.native_ref {
            db.execute(
                "DELETE FROM chat_native_sessions WHERE id = ? AND NOT EXISTS \
                 (SELECT 1 FROM chat_segments WHERE native_session_ref = ?)",
                rusqlite::params![native_ref, native_ref],
            )?;
        }
    }
    if let Some(closed) = &commit.close_active {
        natives::save_snapshot(
            db,
            &closed.native_ref,
            closed.model.as_deref(),
            closed.tuning.as_ref(),
        )?;
        db.execute(
            "UPDATE chat_segments SET closed_at = ? WHERE id = ? AND closed_at IS NULL",
            rusqlite::params![commit.now, closed.segment_id],
        )?;
    }
    if let Some(segment_id) = &commit.reactivate_segment_id {
        db.execute(
            "UPDATE chat_segments SET closed_at = NULL WHERE id = ? AND chat_id = ?",
            rusqlite::params![segment_id, commit.chat_id],
        )?;
    }
    if let Some(open) = &commit.open_segment {
        let native_ref = match &open.native {
            OpenNative::Existing(id) => id.clone(),
            OpenNative::Fresh { id, adapter_id } => {
                natives::insert_fresh(
                    db,
                    id,
                    &commit.chat_id,
                    adapter_id,
                    commit.settings.model.as_deref(),
                )?;
                id.clone()
            }
        };
        insert_segment(
            db,
            &commit.chat_id,
            &open.id,
            open.kind,
            &native_ref,
            &commit.now,
        )?;
    }
    write_settings(db, &commit.chat_id, &commit.settings, &commit.now)?;
    natives::write_mirror(db, &commit.chat_id)
}

/// The non-mirror chat settings a switch resolves: model, permission and plan
/// mode, and tuning. `adapter_id` is written by the mirror, from the native row.
fn write_settings(
    db: &Connection,
    chat_id: &str,
    s: &SwitchSettings,
    now: &str,
) -> Result<(), DbError> {
    let permission = s
        .permission_mode
        .as_ref()
        .map(enum_to_db_string)
        .transpose()?;
    let effort = s.effort.as_ref().map(enum_to_db_string).transpose()?;
    db.execute(
        "UPDATE chats SET model = ?2, permission_mode = COALESCE(?3, permission_mode), plan_mode = ?4,
           effort = ?5, fast = ?6, ultracode = ?7, adaptive_thinking = ?8, updated_at = ?9
         WHERE id = ?1",
        rusqlite::params![
            chat_id,
            s.model,
            permission,
            i64::from(s.plan_mode),
            effort,
            s.fast.map(i64::from),
            s.ultracode.map(i64::from),
            s.adaptive_thinking.map(i64::from),
            now,
        ],
    )?;
    Ok(())
}
