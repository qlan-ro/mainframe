//! Ported from `src/server/suggestions/*` — pure suggestion-building logic
//! consumed by `routes::suggestions`.

pub mod build_suggestions;

pub use build_suggestions::{
    ChurnInput, build_churn_suggestions, build_todo_suggestions, merge_suggestions,
};
