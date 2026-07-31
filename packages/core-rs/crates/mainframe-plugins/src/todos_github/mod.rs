//! GitHub Issues sync for the todos plugin (todo #286): the workflow-label
//! denylist, the additive schema + store, and the per-field touch map that
//! records local recency without disturbing `todos.updated_at`.

pub mod labels;
pub mod schema;
pub mod store;
pub mod touch;

#[cfg(test)]
mod labels_tests;

#[cfg(test)]
mod store_tests;

#[cfg(test)]
mod touch_tests;
