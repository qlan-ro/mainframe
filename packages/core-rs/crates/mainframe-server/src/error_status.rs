//! The one mapping from a domain error's [`StatusKind`] to the HTTP status a
//! route answers with. Library crates classify their errors through
//! [`HttpStatus`]; this module is the only place that turns the class into a
//! code.

use axum::http::StatusCode;
use axum::response::Response;
use mainframe_types::http_status::{HttpStatus, StatusKind};

use crate::respond::fail;

/// The HTTP status for a status class.
pub fn status_code(kind: StatusKind) -> StatusCode {
    match kind {
        StatusKind::BadRequest => StatusCode::BAD_REQUEST,
        StatusKind::NotFound => StatusCode::NOT_FOUND,
        StatusKind::Conflict => StatusCode::CONFLICT,
        StatusKind::Unprocessable => StatusCode::UNPROCESSABLE_ENTITY,
        StatusKind::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        StatusKind::Internal => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// The HTTP status for `err`.
pub fn status_of(err: &dyn HttpStatus) -> StatusCode {
    status_code(err.status_kind())
}

/// The failure envelope at `err`'s status, carrying its text verbatim.
pub fn fail_with<E: HttpStatus + std::fmt::Display>(err: &E) -> Response {
    fail(status_of(err), err.to_string())
}

/// A client-caused failure answers with its own status and text; an
/// internal one is logged under `context` and answered with the opaque 500.
pub fn fail_or_internal<E: HttpStatus + std::fmt::Display>(context: &str, err: &E) -> Response {
    match err.status_kind() {
        StatusKind::Internal => crate::async_err::internal_error(context, err),
        _ => fail_with(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_class_has_its_status() {
        let cases = [
            (StatusKind::BadRequest, 400),
            (StatusKind::NotFound, 404),
            (StatusKind::Conflict, 409),
            (StatusKind::Unprocessable, 422),
            (StatusKind::Unavailable, 503),
            (StatusKind::Internal, 500),
        ];
        for (kind, code) in cases {
            assert_eq!(status_code(kind).as_u16(), code);
        }
    }
}
