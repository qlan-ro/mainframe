//! The chat and project service surfaces exposed to plugins, backed by the
//! host database.

pub mod chat_service;

pub(crate) use chat_service::build_chat_service;
