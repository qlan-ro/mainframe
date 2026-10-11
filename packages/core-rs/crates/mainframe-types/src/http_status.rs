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
    /// 500: the daemon failed to carry out a valid request.
    Internal,
}

/// Classifies an error for the REST surface.
pub trait HttpStatus {
    fn status_kind(&self) -> StatusKind;
}
