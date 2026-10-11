//! Refinement failures for wire structs whose zod schema carries constraints
//! serde cannot express (non-empty strings, positive sizes). The texts mirror
//! the TypeScript schema messages.

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RefinementError {
    /// A `z.string().min(1)` field is empty.
    #[error("{0} must contain at least 1 character")]
    TooShort(&'static str),
    /// One of several required fields is empty; names them together.
    #[error("{0} must be non-empty")]
    Empty(&'static str),
    /// One of several size fields is zero or negative; names them together.
    #[error("{0} must be positive")]
    NotPositive(&'static str),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texts_match_the_schema_messages() {
        assert_eq!(
            RefinementError::TooShort("host").to_string(),
            "host must contain at least 1 character"
        );
        assert_eq!(
            RefinementError::Empty("id and cwd").to_string(),
            "id and cwd must be non-empty"
        );
        assert_eq!(
            RefinementError::NotPositive("cols and rows").to_string(),
            "cols and rows must be positive"
        );
    }
}
