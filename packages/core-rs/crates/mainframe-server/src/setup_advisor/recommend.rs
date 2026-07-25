//! Evaluates the rules dataset against a fingerprint.

use mainframe_types::setup_advisor::{AutomationRecommendation, ProjectFingerprint};

/// Returns the recommendations whose evidence is actually present in `fp`, in
/// canonical category order then rule priority. Never pads.
pub fn recommend(_fp: &ProjectFingerprint) -> Vec<AutomationRecommendation> {
    Vec::new()
}
