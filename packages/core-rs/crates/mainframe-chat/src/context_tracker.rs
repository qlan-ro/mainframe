use mainframe_types::seam_error::SeamError;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use mainframe_adapter_api::AdapterRegistry;
use mainframe_adapter_api::{AdapterSession, BoxFuture};
use mainframe_types::chat::{ChatMessage, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;
use mainframe_types::context::{
    ContextFile, MentionKind, MentionSource, SessionAttachment, SessionContext, SessionMention,
    SkillFileEntry,
};
use mainframe_types::time::now_iso8601;

/// The `db.chats.*` surface `context-tracker` reads (narrow slice of `DatabaseManager`).
pub trait ContextDb: Send + Sync {
    fn add_mention(&self, chat_id: &str, mention: &SessionMention) -> Result<bool, SeamError>;
    fn get_mentions(&self, chat_id: &str) -> Result<Vec<SessionMention>, SeamError>;
    fn get_plan_files(&self, chat_id: &str) -> Result<Vec<String>, SeamError>;
    fn get_skill_files(&self, chat_id: &str) -> Result<Vec<SkillFileEntry>, SeamError>;
}

/// `attachmentStore?.list(chatId)`.
pub trait AttachmentLister: Send + Sync {
    fn list<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Vec<SessionAttachment>>;
}

pub fn extract_mentions_from_text(
    chat_id: &str,
    text: Option<&str>,
    db: &dyn ContextDb,
) -> Result<bool, SeamError> {
    let Some(text) = text else {
        return Ok(false);
    };
    if text.is_empty() {
        return Ok(false);
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
            if db.add_mention(chat_id, &mention)? {
                changed = true;
            }
        } else {
            i += 1;
        }
    }
    Ok(changed)
}

pub async fn get_session_context(
    chat_id: &str,
    project_path: &str,
    db: &dyn ContextDb,
    adapters: &AdapterRegistry,
    session: Option<&Arc<dyn AdapterSession>>,
    attachment_store: Option<&dyn AttachmentLister>,
    adapter_id: Option<&str>,
) -> Result<SessionContext, SeamError> {
    let (global_files, project_files) = context_files(project_path, adapters, session, adapter_id);

    let to_relative = |p: &str| -> String {
        if Path::new(p).is_absolute() {
            path_relative(project_path, p)
        } else {
            p.to_string()
        }
    };

    let home_dir = dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let deduped_files = dedupe_context_files(global_files, project_files, project_path, &home_dir);

    let raw_mentions = db.get_mentions(chat_id)?;
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
        .get_plan_files(chat_id)?
        .iter()
        .map(|p| to_relative(p))
        .collect();
    let skill_files = dedupe_skill_files(db.get_skill_files(chat_id)?, |p| Path::new(p).exists());

    Ok(SessionContext {
        global_files: deduped_files.global,
        project_files: deduped_files.project,
        mentions,
        attachments,
        modified_files,
        skill_files,
    })
}

/// Drop repeated skill entries. The same skill can be persisted under two paths
/// (a live probe hitting a real SKILL.md vs. a batch re-extraction falling back
/// to a conventional `~/.claude/skills/<leaf>/SKILL.md` stub), which path-only
/// dedup lets through (#222). Display-name-only dedup over-corrects: two genuinely
/// different skills that share a leaf name (e.g. a personal `tdd` and a plugin
/// `superpowers:tdd`) would collapse, hiding one that was actually used.
///
/// So within a same-display-name group we let on-disk existence break the tie:
/// keep every entry whose file exists (distinct real skills survive), and drop
/// the non-existent fallback stubs. When nothing in the group exists, keep the
/// first so the skill name still surfaces. `path_exists` is injectable for tests.
pub(crate) fn dedupe_skill_files(
    skills: Vec<SkillFileEntry>,
    path_exists: impl Fn(&str) -> bool,
) -> Vec<SkillFileEntry> {
    let by_path = dedupe_skills_by_path(skills);
    let key_of = |s: &SkillFileEntry| -> String {
        if s.display_name.is_empty() {
            s.path.clone()
        } else {
            s.display_name.clone()
        }
    };

    let mut exists: HashMap<String, bool> = HashMap::new();
    for s in &by_path {
        exists.insert(s.path.clone(), path_exists(&s.path));
    }
    let mut group_has_real: HashSet<String> = HashSet::new();
    for s in &by_path {
        if exists.get(&s.path).copied().unwrap_or(false) {
            group_has_real.insert(key_of(s));
        }
    }

    let mut kept_fallback_key: HashSet<String> = HashSet::new();
    let mut out: Vec<SkillFileEntry> = Vec::new();
    for s in by_path {
        let key = key_of(&s);
        if group_has_real.contains(&key) {
            if exists.get(&s.path).copied().unwrap_or(false) {
                out.push(s);
            }
        } else if !kept_fallback_key.contains(&key) {
            kept_fallback_key.insert(key);
            out.push(s);
        }
    }
    out
}

fn dedupe_skills_by_path(skills: Vec<SkillFileEntry>) -> Vec<SkillFileEntry> {
    let mut seen: HashSet<String> = HashSet::new();
    skills
        .into_iter()
        .filter(|s| seen.insert(s.path.clone()))
        .collect()
}

/// `{ global, project }` result of `dedupeContextFiles`.
pub struct DedupedContextFiles {
    pub global: Vec<ContextFile>,
    pub project: Vec<ContextFile>,
}

/// Remove exact path repeats within each list and any project file that resolves
/// to the same physical file as a global one (e.g. a session opened at the home
/// dir, where .claude/CLAUDE.md IS the global CLAUDE.md) so it isn't listed twice
/// (#222). Global entries are kept as canonical.
pub(crate) fn dedupe_context_files(
    global: Vec<ContextFile>,
    project: Vec<ContextFile>,
    project_path: &str,
    home_dir: &str,
) -> DedupedContextFiles {
    let deduped_global = dedupe_by_path(global);
    let global_abs: HashSet<String> = deduped_global
        .iter()
        .map(|f| to_absolute_context_path(&f.path, project_path, home_dir))
        .collect();
    let deduped_project = dedupe_by_path(project)
        .into_iter()
        .filter(|f| {
            !global_abs.contains(&to_absolute_context_path(&f.path, project_path, home_dir))
        })
        .collect();
    DedupedContextFiles {
        global: deduped_global,
        project: deduped_project,
    }
}

fn dedupe_by_path(files: Vec<ContextFile>) -> Vec<ContextFile> {
    let mut seen: HashSet<String> = HashSet::new();
    files
        .into_iter()
        .filter(|f| seen.insert(f.path.clone()))
        .collect()
}

fn to_absolute_context_path(p: &str, project_path: &str, home_dir: &str) -> String {
    if p == "~" {
        return home_dir.to_string();
    }
    if let Some(rest) = p.strip_prefix("~/") {
        return join_path(home_dir, rest);
    }
    if Path::new(p).is_absolute() {
        return p.to_string();
    }
    join_path(project_path, p)
}

/// POSIX `path.join(base, rest)` for the single-segment-relative inputs this
/// module handles (no `.`/`..` normalization is exercised by the callers).
fn join_path(base: &str, rest: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        rest.trim_start_matches('/')
    )
}

pub(crate) fn extract_latest_plan_file_from_messages(messages: &[ChatMessage]) -> Option<String> {
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

pub(crate) fn extract_plan_file_path_from_text(text: &str) -> Option<String> {
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

mod files;
use files::context_files;
#[cfg(test)]
#[path = "context_tracker_tests.rs"]
mod tests;
