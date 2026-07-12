//! Ported from `src/attachment/attachment-helpers.ts`.

use super::attachment_store::StoredAttachment;

pub fn escape_xml_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn build_attached_file_path_tag(attachment: &StoredAttachment) -> String {
    let name = escape_xml_attr(&attachment.name);
    let media_type = escape_xml_attr(&attachment.media_type);
    let size_bytes = attachment.size_bytes;
    let resolved_path = escape_xml_attr(
        attachment
            .materialized_path
            .as_deref()
            .or(attachment.original_path.as_deref())
            .unwrap_or(&attachment.name),
    );
    format!(
        "<attached_file_path name=\"{name}\" path=\"{resolved_path}\" media_type=\"{media_type}\" size_bytes=\"{size_bytes}\" />"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachment::attachment_store::AttachmentKind;

    fn sample() -> StoredAttachment {
        StoredAttachment {
            name: "a<b>&c.png".to_string(),
            media_type: "image/png".to_string(),
            size_bytes: 42,
            kind: AttachmentKind::Image,
            data: String::new(),
            original_path: None,
            materialized_path: None,
        }
    }

    #[test]
    fn escapes_ampersand_quote_lt_gt() {
        assert_eq!(escape_xml_attr("a&\"<>"), "a&amp;&quot;&lt;&gt;");
    }

    #[test]
    fn falls_back_to_name_when_no_paths() {
        let tag = build_attached_file_path_tag(&sample());
        assert_eq!(
            tag,
            "<attached_file_path name=\"a&lt;b&gt;&amp;c.png\" path=\"a&lt;b&gt;&amp;c.png\" media_type=\"image/png\" size_bytes=\"42\" />"
        );
    }

    #[test]
    fn prefers_materialized_then_original_path() {
        let mut a = sample();
        a.original_path = Some("/orig/x.png".to_string());
        assert!(build_attached_file_path_tag(&a).contains("path=\"/orig/x.png\""));
        a.materialized_path = Some("/mat/y.png".to_string());
        assert!(build_attached_file_path_tag(&a).contains("path=\"/mat/y.png\""));
    }
}

// PORT STATUS: src/attachment/attachment-helpers.ts (13 lines)
// confidence: high
// todos: 0
// notes: escapeXmlAttr chained replaces (same order: & " < >). resolvedPath uses
// materializedPath ?? originalPath ?? name via Option::or. No TS test existed;
// added three focused tests. size_bytes is i64 (types crate); formats identically.
