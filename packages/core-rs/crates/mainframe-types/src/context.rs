//! Ported from `packages/types/src/context.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContextFileSource {
    Global,
    Project,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextFile {
    pub path: String,
    pub content: String,
    pub source: ContextFileSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MentionSource {
    User,
    Auto,
    Attachment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MentionKind {
    File,
    Agent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMention {
    pub id: String,
    pub kind: MentionKind,
    pub source: MentionSource,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionAttachmentKind {
    Image,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAttachment {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub size_bytes: i64,
    pub kind: SessionAttachmentKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileEntry {
    pub path: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionContext {
    pub global_files: Vec<ContextFile>,
    pub project_files: Vec<ContextFile>,
    pub mentions: Vec<SessionMention>,
    pub attachments: Vec<SessionAttachment>,
    pub modified_files: Vec<String>,
    pub skill_files: Vec<SkillFileEntry>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mention_omits_path_when_absent() {
        let m = SessionMention {
            id: "m1".to_string(),
            kind: MentionKind::Agent,
            source: MentionSource::Auto,
            name: "planner".to_string(),
            path: None,
            timestamp: "2026-07-08T00:00:00Z".to_string(),
        };
        assert_eq!(
            serde_json::to_string(&m).unwrap(),
            r#"{"id":"m1","kind":"agent","source":"auto","name":"planner","timestamp":"2026-07-08T00:00:00Z"}"#
        );
    }

    #[test]
    fn attachment_round_trips() {
        let json = r#"{"id":"a1","name":"shot.png","mediaType":"image/png","sizeBytes":1024,"kind":"image","originalPath":"/tmp/shot.png"}"#;
        let a: SessionAttachment = serde_json::from_str(json).unwrap();
        assert_eq!(a.size_bytes, 1024);
        assert_eq!(a.kind, SessionAttachmentKind::Image);
        assert_eq!(serde_json::to_string(&a).unwrap(), json);
    }
}

// PORT STATUS: packages/types/src/context.ts (41 lines)
// confidence: high
// todos: 0
// notes: literal-union `source`/`kind` fields → dedicated enums (ContextFileSource,
// MentionSource, MentionKind, SessionAttachmentKind). sizeBytes → i64 (byte count).
// Optional `path`/`originalPath` → Option + skip_serializing_if.
