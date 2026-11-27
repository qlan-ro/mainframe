//! GitHub Issues sync for the todos plugin: the workflow-label denylist, the
//! schema and typed store, the pure reconcile step and the run driver, the
//! pairing flows, the HTTP routes, and the per-field touch map that records
//! local recency without disturbing `todos.updated_at`.

pub(crate) mod labels;
pub(crate) mod pairing;
pub(crate) mod reconcile;
pub(crate) mod routes;
pub(crate) mod run;
pub(crate) mod schema;
pub(crate) mod store;
pub(crate) mod touch;

#[cfg(test)]
#[path = "acceptance_tests_mod.rs"]
mod acceptance_tests;

#[cfg(test)]
mod atomicity_tests;

#[cfg(test)]
mod fake_github;

#[cfg(test)]
mod labels_tests;

#[cfg(test)]
mod pairing_tests;

#[cfg(test)]
#[path = "reconcile_tests_mod.rs"]
mod reconcile_tests;

#[cfg(test)]
mod run_cancel_tests;

#[cfg(test)]
mod run_failure_tests;

#[cfg(test)]
mod run_test_support;

#[cfg(test)]
mod run_tests;

#[cfg(test)]
#[path = "routes_tests_mod.rs"]
mod routes_tests;

#[cfg(test)]
#[path = "store_tests_mod.rs"]
mod store_tests;

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod touch_tests;
