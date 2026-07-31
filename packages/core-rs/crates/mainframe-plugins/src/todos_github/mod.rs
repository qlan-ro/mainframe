//! GitHub Issues sync for the todos plugin (todo #286): the workflow-label
//! denylist, the additive schema + store, and the per-field touch map that
//! records local recency without disturbing `todos.updated_at`.

pub mod labels;
pub mod pairing;
pub mod reconcile;
pub mod routes;
pub mod run;
pub mod schema;
pub mod store;
pub mod touch;

#[cfg(test)]
mod acceptance_tests;

#[cfg(test)]
mod fake_github;

#[cfg(test)]
mod labels_tests;

#[cfg(test)]
mod pairing_tests;

#[cfg(test)]
mod reconcile_tests;

#[cfg(test)]
mod run_failure_tests;

#[cfg(test)]
mod run_test_support;

#[cfg(test)]
mod run_tests;

#[cfg(test)]
mod routes_tests;

#[cfg(test)]
mod store_tests;

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod touch_tests;
