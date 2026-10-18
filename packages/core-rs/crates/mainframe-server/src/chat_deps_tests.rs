use mainframe_services::quota::IngestMode;
use mainframe_types::{
    adapter::DetectedPr,
    chat_patch::ChatPatch,
    context::{SessionMention, SkillFileEntry},
};
include!("chat_deps_tests_adapter_and_mentions.rs");
include!("chat_deps_tests_tasks_and_prs.rs");
include!("chat_deps_tests_plans_and_skills.rs");
include!("chat_deps_tests_history_sources.rs");

include!("chat_deps_tests_notifications.rs");
include!("chat_deps_tests_capability_parity.rs");
