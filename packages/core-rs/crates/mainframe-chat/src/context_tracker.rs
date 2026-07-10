//! Ported from `packages/core/src/chat/context-tracker.ts`.

use std::path::Path;
use std::sync::Arc;

use mainframe_adapter_api::AdapterRegistry;
use mainframe_adapter_api::{AdapterSession, BoxFuture};
use mainframe_runtime::time::now_iso8601;
use mainframe_types::chat::{ChatMessage, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::context::{
    ContextFile, MentionKind, MentionSource, SessionAttachment, SessionContext, SessionMention,
    SkillFileEntry,
};

/// The `db.chats.*` surface `context-tracker` reads (narrow slice of `DatabaseManager`).
pub trait ContextDb: Send + Sync {
    fn add_mention(&self, chat_id: &str, mention: &SessionMention) -> bool;
    fn get_mentions(&self, chat_id: &str) -> Vec<SessionMention>;
    fn get_plan_files(&self, chat_id: &str) -> Vec<String>;
    fn get_skill_files(&self, chat_id: &str) -> Vec<SkillFileEntry>;
}

/// `attachmentStore?.list(chatId)`.
pub trait AttachmentLister: Send + Sync {
    fn list<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Vec<SessionAttachment>>;
}

pub fn extract_mentions_from_text(chat_id: &str, text: Option<&str>, db: &dyn ContextDb) -> bool {
    let Some(text) = text else {
        return false;
    };
    if text.is_empty() {
        return false;
    }
    let chars: Vec<char> = text.chars().collect();
    let mut changed = false;
    let mut i = 0;
    while i < chars.len() {
        // /(?:^|\s)@(\S+)/g — `@` at start or after whitespace, capture the run.
        if chars[i] == '@' && (i == 0 || chars[i - 1].is_whitespace()) {
            let mut j = i + 1;
            while j < chars.len() && !chars[j].is_whitespace() {
                j += 1;
            }
            let reference: String = chars[i + 1..j].iter().collect();
            i = j;
            if reference.is_empty() || (!reference.contains('/') && !reference.contains('.')) {
                continue;
            }
            let cleaned = clean_reference(&reference);
            let name = cleaned.rsplit('/').next().unwrap_or(&cleaned).to_string();
            let mention = SessionMention {
                id: nanoid::nanoid!(),
                kind: MentionKind::File,
                source: MentionSource::User,
                name,
                path: Some(cleaned),
                timestamp: now_iso8601(),
            };
            if db.add_mention(chat_id, &mention) {
                changed = true;
            }
        } else {
            i += 1;
        }
    }
    changed
}

#[allow(clippy::too_many_arguments)]
pub async fn get_session_context(
    chat_id: &str,
    project_path: &str,
    db: &dyn ContextDb,
    adapters: &AdapterRegistry,
    session: Option<&Arc<dyn AdapterSession>>,
    attachment_store: Option<&dyn AttachmentLister>,
    adapter_id: Option<&str>,
) -> SessionContext {
    let mut global_files: Vec<ContextFile> = Vec::new();
    let mut project_files: Vec<ContextFile> = Vec::new();
    if let Some(session) = session {
        let files = session.get_context_files();
        global_files = files.global;
        project_files = files.project;
    } else if let Some(adapter) = adapter_id.and_then(|id| adapters.get(id))
        && let Some(files) = adapter.get_context_files(project_path)
    {
        global_files = files.global;
        project_files = files.project;
    }

    let to_relative = |p: &str| -> String {
        if Path::new(p).is_absolute() {
            path_relative(project_path, p)
        } else {
            p.to_string()
        }
    };

    let raw_mentions = db.get_mentions(chat_id);
    let mentions = raw_mentions
        .into_iter()
        .map(|mut m| {
            m.path = m.path.map(|p| to_relative(&p));
            m
        })
        .collect();
    let attachments = match attachment_store {
        Some(store) => store.list(chat_id).await,
        None => Vec::new(),
    };
    let modified_files = db
        .get_plan_files(chat_id)
        .iter()
        .map(|p| to_relative(p))
        .collect();
    let skill_files = db.get_skill_files(chat_id);

    SessionContext {
        global_files,
        project_files,
        mentions,
        attachments,
        modified_files,
        skill_files,
    }
}

pub fn extract_latest_plan_file_from_messages(messages: &[ChatMessage]) -> Option<String> {
    for msg in messages.iter().rev() {
        for block in msg.content.iter().rev() {
            let text = match block {
                MessageContent::Node(MessageContentNode::ToolResult { content, .. }) => {
                    Some(content.as_str())
                }
                MessageContent::Leaf(LeafContent::Text { text, .. }) => Some(text.as_str()),
                _ => None,
            };
            let Some(text) = text else { continue };
            if text.is_empty() {
                continue;
            }
            if let Some(plan_path) = extract_plan_file_path_from_text(text) {
                return Some(plan_path);
            }
        }
    }
    None
}

pub fn extract_plan_file_path_from_text(text: &str) -> Option<String> {
    if let Some(saved) = match_saved_plan(text) {
        return Some(saved);
    }
    match_generic_plan(text)
}

/// `/Your plan has been saved to:\s*(\/\S+\.md)/`.
fn match_saved_plan(text: &str) -> Option<String> {
    const LABEL: &str = "Your plan has been saved to:";
    let idx = text.find(LABEL)?;
    let rest = text[idx + LABEL.len()..].trim_start();
    if !rest.starts_with('/') {
        return None;
    }
    // `\S+\.md` on the leading non-space run: greedy → the LAST `.md` in the run.
    let token: String = rest.chars().take_while(|c| !c.is_whitespace()).collect();
    let pos = token.rfind(".md")?;
    Some(token[..pos + 3].trim().to_string())
}

/// `/(?:^|\s|`)(\/[^\s`]+\.md)(?=$|\s|`)/` — a `/…​.md` run bounded by start/space/backtick.
fn match_generic_plan(text: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    for i in 0..chars.len() {
        if chars[i] != '/' {
            continue;
        }
        let boundary_before = i == 0 || chars[i - 1].is_whitespace() || chars[i - 1] == '`';
        if !boundary_before {
            continue;
        }
        let mut j = i;
        while j < chars.len() && !chars[j].is_whitespace() && chars[j] != '`' {
            j += 1;
        }
        let run: String = chars[i..j].iter().collect();
        // `\/[^\s`]+\.md`: at least one char between `/` and the trailing `.md`.
        if run.ends_with(".md") && run.chars().count() >= 5 {
            return Some(run.trim().to_string());
        }
    }
    None
}

/// `ref.replace(/<\/[^>]+>$/, '').replace(/[,;:!?)]+$/, '')`.
fn clean_reference(reference: &str) -> String {
    let without_tag = strip_trailing_close_tag(reference).unwrap_or_else(|| reference.to_string());
    without_tag
        .trim_end_matches([',', ';', ':', '!', '?', ')'])
        .to_string()
}

/// Strip a trailing `</[^>]+>` closing tag.
fn strip_trailing_close_tag(s: &str) -> Option<String> {
    if !s.ends_with('>') {
        return None;
    }
    let start = s.rfind("</")?;
    let inner = &s[start + 2..s.len() - 1];
    if inner.is_empty() || inner.contains('>') {
        return None;
    }
    Some(s[..start].to_string())
}

/// POSIX `path.relative(from, to)` for the absolute paths this module handles.
fn path_relative(from: &str, to: &str) -> String {
    let from_parts: Vec<&str> = from.split('/').filter(|s| !s.is_empty()).collect();
    let to_parts: Vec<&str> = to.split('/').filter(|s| !s.is_empty()).collect();
    let mut i = 0;
    while i < from_parts.len() && i < to_parts.len() && from_parts[i] == to_parts[i] {
        i += 1;
    }
    let mut out: Vec<String> = Vec::new();
    for _ in i..from_parts.len() {
        out.push("..".to_string());
    }
    for p in &to_parts[i..] {
        out.push((*p).to_string());
    }
    out.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_plan_path_wins() {
        let text = "Your plan has been saved to: /Users/x/proj/.plans/plan.md and more";
        assert_eq!(
            extract_plan_file_path_from_text(text),
            Some("/Users/x/proj/.plans/plan.md".to_string())
        );
    }

    #[test]
    fn generic_backtick_wrapped_path() {
        let text = "see `/tmp/notes.md` now";
        assert_eq!(
            extract_plan_file_path_from_text(text),
            Some("/tmp/notes.md".to_string())
        );
    }

    #[test]
    fn no_match_returns_none() {
        assert_eq!(extract_plan_file_path_from_text("nothing here"), None);
    }

    #[test]
    fn relative_below_project() {
        assert_eq!(path_relative("/a/b", "/a/b/c/d.md"), "c/d.md");
        assert_eq!(path_relative("/a/b/c", "/a/x/y.md"), "../../x/y.md");
    }

    #[test]
    fn clean_reference_strips_tag_and_punctuation() {
        assert_eq!(clean_reference("src/foo.ts),"), "src/foo.ts");
        assert_eq!(
            clean_reference("src/foo.ts</command-message>"),
            "src/foo.ts"
        );
    }
}

// PORT STATUS: src/chat/context-tracker.ts (89 lines)
// confidence: medium
// todos: 0
// notes: 4 free functions ported. The four JS regexes are hand-rolled (no regex
// notes: crate in the allowlist): `@(\S+)` mention scan, the two plan-path patterns
// notes: (saved = last `.md` in the leading run; generic = a `/…​.md` run bounded by
// notes: start/space/backtick), and the `</…>`+trailing-punct ref cleanup — medium
// notes: confidence pending a fixture. `path.relative` → a POSIX `path_relative`
// notes: (absolute inputs only, as the callers guarantee). `db`/`attachmentStore`
// notes: are narrow injected traits; `adapters` uses the concrete AdapterRegistry
// notes: (get_context_files is on the Adapter trait). No TS test file; added sanity
// notes: tests for the hand-rolled parsers.
