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

/// `AskUserQuestion`'s options: one per flattened Codex choice that carries
/// a label, all `AllowOnce` — selecting any offered choice picks an answer,
/// never a decline (D4). Each option's meta carries `updatedInput.answers`
/// keyed by the question text, the same shape
/// `extract_answer_from_updated_input` already reads off a rich
/// `_mainframe.dev` answer.
pub(crate) fn ask_user_question_options(
    request_id: &str,
    question_text: &str,
    flat_labels: &[String],
) -> Vec<PermissionOption> {
    if unanswerable("AskUserQuestion", request_id, flat_labels) {
        return Vec::new();
    }
    flat_labels
        .iter()
        .enumerate()
        .filter(|(_, label)| !label.trim().is_empty())
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

/// `ExitPlanMode`'s options: one per labelled Codex choice. `resolve`'s
/// ExitPlanMode branch reads `behavior` alone and ignores `updated_input`
/// (`find_by_prefix`'s yes/no label matching), so a choice whose label starts
/// with "no" maps to `RejectOnce` and everything else to `AllowOnce`,
/// matching that branch's own effect exactly.
pub(crate) fn exit_plan_mode_options(
    request_id: &str,
    flat_labels: &[String],
) -> Vec<PermissionOption> {
    if unanswerable("ExitPlanMode", request_id, flat_labels) {
        return Vec::new();
    }
    flat_labels
        .iter()
        .enumerate()
        .filter(|(_, label)| !label.trim().is_empty())
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

/// Whether there is nothing here a client could pick: Codex sent no options,
/// or every label arrived blank — the labels are read with `unwrap_or("")`,
/// so an option object carrying no string label reaches us as an empty one.
/// Said out loud, because the facade turns an empty option list into a gate
/// offering reject alone (`mainframe_acp::gates`); without this line that gate
/// reads as a daemon bug rather than as the labels Codex never sent.
fn unanswerable(tool_name: &str, request_id: &str, flat_labels: &[String]) -> bool {
    if flat_labels.iter().any(|label| !label.trim().is_empty()) {
        return false;
    }
    tracing::warn!(
        module = "codex:approvals",
        tool_name,
        request_id,
        "codex sent no usable option labels; the gate can only be rejected"
    );
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An empty list offers nothing, which is what the facade turns into a
    /// reject-only gate.
    #[test]
    fn empty_labels_still_offer_no_options() {
        assert!(exit_plan_mode_options("req_1", &[]).is_empty());
        assert!(ask_user_question_options("req_1", "Which file?", &[]).is_empty());
    }

    /// Labels are read with `unwrap_or("")`, so an option object carrying no
    /// string label reaches these builders as a blank one. Offering it would
    /// hand the client a nameless button whose answer is the empty string
    /// Codex takes for a real choice.
    #[test]
    fn all_blank_labels_offer_no_options() {
        let blanks = [String::new(), "   ".to_string()];
        assert!(exit_plan_mode_options("req_1", &blanks).is_empty());
        assert!(ask_user_question_options("req_1", "Which file?", &blanks).is_empty());
    }

    /// A blank among real labels is nothing to offer: no one reads
    /// `choice-{i}` back — the answer travels as the option's kind and meta —
    /// so keeping the blank's place would only add a nameless button whose
    /// answer is the empty string. The real labels keep their own index.
    #[test]
    fn blank_labels_are_dropped_and_real_ones_keep_their_index() {
        let labels = ["   ".to_string(), "No, keep planning".to_string()];

        let offered = exit_plan_mode_options("req_1", &labels);
        assert_eq!(offered.len(), 1, "{offered:?}");
        assert_eq!(offered[0].option_id, "choice-1");
        assert_eq!(offered[0].name, "No, keep planning");

        let asked = ask_user_question_options("req_1", "Which file?", &labels);
        assert_eq!(asked.len(), 1, "{asked:?}");
        assert_eq!(asked[0].option_id, "choice-1");
        assert_eq!(asked[0].name, "No, keep planning");
    }
}
