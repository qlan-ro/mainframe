//! Walks a project root and assembles its `ProjectFingerprint`.

use std::path::Path;

use mainframe_types::setup_advisor::ProjectFingerprint;

/// Fingerprints the project rooted at `root`.
///
/// Takes only a root so todo #192 can import it standalone; it knows nothing
/// about recommendations.
pub async fn fingerprint(_root: &Path) -> ProjectFingerprint {
    ProjectFingerprint::default()
}
