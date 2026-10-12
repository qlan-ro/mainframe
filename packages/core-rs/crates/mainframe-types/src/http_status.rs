//! The HTTP status class a domain error maps to. Library crates classify their
//! errors with [`HttpStatus`]; the server turns the [`StatusKind`] into a
//! concrete status code in one place, so no crate below it depends on `http`.

/// The status class a failure answers with on the REST surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusKind {
    /// 400: the request itself is malformed or refers to something unusable.
    BadRequest,
    /// 404: the named entity does not exist.
    NotFound,
    /// 409: the request is valid but the current state refuses it.
    Conflict,
    /// 422: the request is well-formed but names something the daemon cannot serve.
    Unprocessable,
    /// 503: a backing service the request needs is not available right now.
    Unavailable,
    /// 500: the daemon failed to carry out a valid request.
    Internal,
}

/// Classifies an error for the REST surface.
pub trait HttpStatus {
    fn status_kind(&self) -> StatusKind;
}

/// A named entity an operation needs does not exist. Displays as
/// `"{entity} {id} not found"`, or `"{entity} not found"` for the call sites
/// whose wire text never named the id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotFound {
    pub entity: &'static str,
    pub id: Option<String>,
}

impl NotFound {
    /// `"{entity} {id} not found"`.
    pub fn new(entity: &'static str, id: impl Into<String>) -> Self {
        Self {
            entity,
            id: Some(id.into()),
        }
    }

    /// `"{entity} not found"`.
    pub fn unnamed(entity: &'static str) -> Self {
        Self { entity, id: None }
    }
}

impl std::fmt::Display for NotFound {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.id {
            Some(id) => write!(f, "{} {id} not found", self.entity),
            None => write!(f, "{} not found", self.entity),
        }
    }
}

impl std::error::Error for NotFound {}

impl HttpStatus for NotFound {
    fn status_kind(&self) -> StatusKind {
        StatusKind::NotFound
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_texts_keep_the_wire_shapes() {
        assert_eq!(NotFound::new("Chat", "c1").to_string(), "Chat c1 not found");
        assert_eq!(
            NotFound::unnamed("Project").to_string(),
            "Project not found"
        );
        assert_eq!(
            NotFound::unnamed("Project").status_kind(),
            StatusKind::NotFound
        );
    }
}
