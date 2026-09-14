//! Adapter-supplied option lists for Codex `ControlRequest`s (T19, R3.2 and
//! R3.5, blockers; D4): approvals offer accept/acceptForSession/decline;
//! `requestUserInput` offers its own real question choices — no synthetic
//! decline (D4 scopes decline to approvals only; a generic client declines a
//! question via `session/cancel`, the ACP-mandated path).

use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::acp::permission::{PermissionOption, PermissionOptionKind};
use serde_json::json;

/// `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`'s
/// fixed triad. Option ids are Codex's own decision strings, so `resolve`
/// needs no separate id-to-decision table.
pub(crate) fn approval_triad() -> Vec<PermissionOption> {
    vec![
        PermissionOption {
            option_id: "accept".to_string(),
            name: "Accept".to_string(),
            kind: PermissionOptionKind::AllowOnce,
            meta: None,
        },
        PermissionOption {
            option_id: "acceptForSession".to_string(),
            name: "Accept for session".to_string(),
            kind: PermissionOptionKind::AllowAlways,
            meta: None,
        },
        PermissionOption {
            option_id: "decline".to_string(),
            name: "Decline".to_string(),
            kind: PermissionOptionKind::RejectOnce,
            meta: None,
        },
    ]
}

/// `AskUserQuestion`'s options: one per flattened Codex choice, all
/// `AllowOnce` — selecting any offered choice picks an answer, never a
/// decline (D4). Each option's meta carries `updatedInput.answers` keyed by
/// the question text, the same shape `extract_answer_from_updated_input`
/// already reads off a rich `_mainframe.dev` answer.
pub(crate) fn ask_user_question_options(
    question_text: &str,
    flat_labels: &[String],
) -> Vec<PermissionOption> {
    flat_labels
        .iter()
        .enumerate()
        .map(|(i, label)| PermissionOption {
            option_id: format!("choice-{i}"),
            name: label.clone(),
            kind: PermissionOptionKind::AllowOnce,
            meta: Some(json!({
                MAINFRAME_META_NAMESPACE: {
                    "updatedInput": { "answers": { question_text: label } }
                }
            })),
        })
        .collect()
}

/// `ExitPlanMode`'s options: `resolve`'s ExitPlanMode branch reads
/// `behavior` alone and ignores `updated_input` (`find_by_prefix`'s yes/no
/// label matching), so a choice whose label starts with "no" maps to
/// `RejectOnce` and everything else to `AllowOnce`, matching that branch's
/// own effect exactly.
pub(crate) fn exit_plan_mode_options(flat_labels: &[String]) -> Vec<PermissionOption> {
    flat_labels
        .iter()
        .enumerate()
        .map(|(i, label)| PermissionOption {
            option_id: format!("choice-{i}"),
            name: label.clone(),
            kind: if label.to_lowercase().starts_with("no") {
                PermissionOptionKind::RejectOnce
            } else {
                PermissionOptionKind::AllowOnce
            },
            meta: None,
        })
        .collect()
}
