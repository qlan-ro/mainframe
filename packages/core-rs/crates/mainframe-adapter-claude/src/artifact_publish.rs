//! Spots a finished Artifact publish in tool results, so open previews can follow.
//!
//! The CLI's publish result is prose for the model, but it always opens by naming
//! where the artifact now lives: "Created a new Artifact at <url>", "Updated the
//! Artifact at <url>", "Published <path> at <url>", or a retry's "An earlier attempt
//! of this call already created the Artifact at <url>". Only that opening line is
//! read, so an artifact's own content quoted later in the result can't pose as one.

use mainframe_types::chat::{MessageContent, MessageContentNode};

const ARTIFACT_URL: &str = "https://claude.ai/artifact/";
const OPENINGS: [&str; 4] = [
    "Created a new Artifact at ",
    "Updated the Artifact at ",
    "Published ",
    "An earlier attempt of this call already created the Artifact at ",
];

fn published_url(result: &str) -> Option<String> {
    let first_line = result.trim_start().lines().next()?;
    if !OPENINGS
        .iter()
        .any(|opening| first_line.starts_with(opening))
    {
        return None;
    }
    let start = first_line.find(ARTIFACT_URL)?;
    let slug: String = first_line[start + ARTIFACT_URL.len()..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    (!slug.is_empty()).then(|| format!("{ARTIFACT_URL}{slug}"))
}

/// The artifacts that successful results in `blocks` just published.
pub(crate) fn published_artifacts(blocks: &[MessageContent]) -> Vec<String> {
    blocks
        .iter()
        .filter_map(|block| match block {
            MessageContent::Node(MessageContentNode::ToolResult {
                content,
                is_error: false,
                ..
            }) => published_url(content),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://claude.ai/artifact/V1LAdjrXoKC7jVLpHnV1D2";

    #[test]
    fn reads_every_publish_wording() {
        for result in [
            format!("Created a new Artifact at {URL} (version 1) from the Artifact type x."),
            format!("Updated the Artifact at {URL} (Version 2, version id 1-a) with a.json"),
            format!("Published /tmp/page.html at {URL}."),
            format!(
                "An earlier attempt of this call already created the Artifact at {URL} (version 1)"
            ),
        ] {
            assert_eq!(published_url(&result).as_deref(), Some(URL), "{result}");
        }
    }

    #[test]
    fn ignores_reads_lists_and_quoted_content() {
        assert_eq!(published_url(&format!("Read \"x\" from {URL}")), None);
        assert_eq!(
            published_url(&format!("16 published artifacts:\n- {URL}")),
            None
        );
        assert_eq!(
            published_url(&format!("Some text\nUpdated the Artifact at {URL}")),
            None
        );
        assert_eq!(published_url("Published nothing yet"), None);
    }

    #[test]
    fn only_successful_results_count() {
        let result = |content: &str, is_error: bool| {
            MessageContent::Node(MessageContentNode::ToolResult {
                tool_use_id: "t".to_string(),
                content: content.to_string(),
                is_error,
                structured_patch: None,
                original_file: None,
                modified_file: None,
                images: Vec::new(),
                parent_tool_use_id: None,
            })
        };
        let created = format!("Created a new Artifact at {URL} (version 1).");
        assert_eq!(
            published_artifacts(&[result(&created, false)]),
            vec![URL.to_string()]
        );
        assert!(published_artifacts(&[result(&created, true)]).is_empty());
    }
}
