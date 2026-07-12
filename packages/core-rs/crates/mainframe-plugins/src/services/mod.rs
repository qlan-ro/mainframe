//! Ported from `packages/core/src/plugins/services/` — the chat and project
//! service surfaces exposed to plugins, backed by the host database.

pub mod chat_service;
pub mod project_service;

pub use chat_service::build_chat_service;
pub use project_service::build_project_service;

// PORT STATUS: src/plugins/services/ (module barrel)
// confidence: high
// todos: 0
// notes: both services map host db rows (Chat/Project) to the DTO summaries;
// createChat gates on the chat:create capability (can_create_chat).
