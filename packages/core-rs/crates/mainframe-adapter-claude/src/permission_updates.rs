//! Outbound permission updates: forward each update it may save to the
//! destination it declares. The CLI encodes the user's intent there (PERMISSIONS.md) — Bash
//! suggestions arrive `localSettings`, file/directory suggestions arrive
//! `session` — and it is the CLI, not Mainframe, that persists them.

use mainframe_types::adapter::{ControlDestination, ControlUpdate};

/// A mode change never becomes the project default implicitly (#283): making a
/// permission mode persistent is a deliberate act in settings, not a side effect
/// of answering one prompt. A mode wider than Auto-Edits, and an update this build
/// cannot read, are not forwarded at all: the chat layer has already taken them out
/// and said so, and this is the last place that could let one through. Every other
/// update keeps its declared destination.
pub(crate) fn forwardable_updates(updates: Vec<ControlUpdate>) -> Vec<ControlUpdate> {
    updates
        .into_iter()
        .filter(|update| {
            let grantable = update.grantable();
            if !grantable {
                tracing::warn!(update = ?update.withheld_label(), "permission update not forwarded");
            }
            grantable
        })
        .map(|u| match u {
            ControlUpdate::SetMode { mode, destination } => match destination {
                // In-memory destinations (PERMISSIONS.md:104-113): nothing is persisted, so the update stands.
                ControlDestination::Session | ControlDestination::CliArg => {
                    ControlUpdate::SetMode { mode, destination }
                }
                ControlDestination::UserSettings
                | ControlDestination::ProjectSettings
                | ControlDestination::LocalSettings => {
                    tracing::warn!(
                        ?mode,
                        ?destination,
                        "setMode update pointed at a persisting destination; forwarding it session-scoped"
                    );
                    ControlUpdate::SetMode {
                        mode,
                        destination: ControlDestination::Session,
                    }
                }
            },
            // An update kind this adapter does not special-case is forwarded verbatim — the fix's thesis.
            _ => u,
        })
        .collect()
}

#[cfg(test)]
#[path = "permission_updates_tests.rs"]
mod tests;
