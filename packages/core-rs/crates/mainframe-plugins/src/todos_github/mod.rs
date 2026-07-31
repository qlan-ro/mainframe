//! GitHub Issues sync for the todos plugin (todo #286): the workflow-label
//! denylist, the additive schema + store, and the per-field touch map that
//! records local recency without disturbing `todos.updated_at`.

pub mod labels;

#[cfg(test)]
mod labels_tests;
