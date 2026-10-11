//! A request body or query a route refuses. Every variant answers 400 with its
//! text as the error body; the texts mirror the zod messages the UI was built
//! against, so they are wire contract.

use mainframe_types::http_status::{HttpStatus, StatusKind};

#[derive(Debug, thiserror::Error)]
pub enum InputError {
    /// One fixed refusal (`"Invalid token"`).
    #[error("{0}")]
    Rejected(&'static str),
    /// Every rule the input breaks, in check order, joined with `, `.
    #[error("{}", .0.join(", "))]
    Issues(Vec<&'static str>),
    /// zod's `z.string()` type mismatch; carries the JSON `typeof` received.
    #[error("Invalid input: expected string, received {0}")]
    ExpectedString(&'static str),
    /// A body that does not fit the route's schema; serde's reason.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl HttpStatus for InputError {
    fn status_kind(&self) -> StatusKind {
        StatusKind::BadRequest
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texts_are_the_400_bodies() {
        assert_eq!(
            InputError::Rejected("Invalid url").to_string(),
            "Invalid url"
        );
        assert_eq!(
            InputError::Issues(vec!["Required", "path is required"]).to_string(),
            "Required, path is required"
        );
        assert_eq!(
            InputError::ExpectedString("number").to_string(),
            "Invalid input: expected string, received number"
        );
        assert_eq!(
            InputError::Rejected("x").status_kind(),
            StatusKind::BadRequest
        );
    }
}
