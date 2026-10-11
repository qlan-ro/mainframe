use mainframe_types::{
    adapter::DetectedPr,
    chat_patch::ChatPatch,
    context::{SessionMention, SkillFileEntry},
};
include!("tests/adapter_and_mentions.rs");
include!("tests/tasks_and_prs.rs");
include!("tests/plans_and_skills.rs");
include!("tests/history_sources.rs");

include!("tests/notifications.rs");
include!("tests/capability_parity.rs");
