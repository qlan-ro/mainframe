//! Token resolution + literal substitution. `Scope::resolve` returns the raw
//! typed value (comparators and Repeat need a real list/number, not a string);
//! `substitute::render` stringifies for prompt/param text.

pub mod compare;
pub mod scope;
pub mod substitute;
pub mod value;
pub mod variables;

pub use compare::evaluate;
pub use scope::Scope;
pub use substitute::render;
pub use value::TokenValue;
pub(crate) use variables::build_name_index;
pub use variables::{NameIndex, NameMap, NameTarget};

#[cfg(test)]
mod compare_tests;

#[cfg(test)]
mod substitute_tests;

#[cfg(test)]
mod variables_tests;
