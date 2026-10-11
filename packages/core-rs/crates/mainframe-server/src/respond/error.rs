use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use mainframe_types::http_status::{HttpStatus, StatusKind};
use mainframe_types::seam_error::SeamError;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Unavailable(String),
    #[error("{0}")]
    Unprocessable(String),
    #[error("{message}")]
    Http { status: StatusCode, message: String },
    #[error("{context}: {source}")]
    Internal {
        context: String,
        source: SeamError,
        public_message: Option<String>,
    },
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self::from_status(status, message.into())
    }
    pub fn internal(context: impl Into<String>, source: impl std::fmt::Display) -> Self {
        Self::Internal {
            context: context.into(),
            source: SeamError::msg(source.to_string()),
            public_message: None,
        }
    }

    pub fn from_status(status: StatusCode, message: String) -> Self {
        match status {
            StatusCode::NOT_FOUND => Self::NotFound(message),
            StatusCode::BAD_REQUEST => Self::BadRequest(message),
            StatusCode::CONFLICT => Self::Conflict(message),
            StatusCode::SERVICE_UNAVAILABLE => Self::Unavailable(message),
            StatusCode::UNPROCESSABLE_ENTITY => Self::Unprocessable(message),
            StatusCode::INTERNAL_SERVER_ERROR => Self::Internal {
                context: "request failed".into(),
                source: SeamError::msg(message.clone()),
                public_message: Some(message),
            },
            _ => Self::Http { status, message },
        }
    }

    pub fn from_domain<E: HttpStatus + std::fmt::Display>(error: &E) -> Self {
        Self::from_status(status_of(error), error.to_string())
    }

    pub fn chat_not_found() -> Self {
        Self::NotFound("Chat not found".into())
    }
    pub fn project_not_found() -> Self {
        Self::NotFound("Project not found".into())
    }

    pub fn status(&self) -> StatusCode {
        match self {
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::Unprocessable(_) => StatusCode::UNPROCESSABLE_ENTITY,
            Self::Internal { .. } => StatusCode::INTERNAL_SERVER_ERROR,
            Self::Http { status, .. } => *status,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        if status.is_server_error() {
            tracing::error!(error = %self, "request failed");
        }
        let message = match self {
            Self::Internal { public_message, .. } => {
                public_message.unwrap_or_else(|| "Internal server error".into())
            }
            other => other.to_string(),
        };
        (
            status,
            Json(serde_json::json!({"success": false, "error": message})),
        )
            .into_response()
    }
}

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
pub fn status_of(error: &dyn HttpStatus) -> StatusCode {
    status_code(error.status_kind())
}
pub fn fail_with<E: HttpStatus + std::fmt::Display>(error: &E) -> Response {
    ApiError::from_domain(error).into_response()
}
pub fn fail_or_internal<E: HttpStatus + std::fmt::Display>(context: &str, error: &E) -> Response {
    match error.status_kind() {
        StatusKind::Internal => ApiError::internal(context, error).into_response(),
        _ => fail_with(error),
    }
}

impl From<mainframe_db::DbError> for ApiError {
    fn from(error: mainframe_db::DbError) -> Self {
        if error.status_kind() == StatusKind::Internal {
            Self::Internal {
                context: "database operation".into(),
                source: SeamError::new(error),
                public_message: None,
            }
        } else {
            Self::from_domain(&error)
        }
    }
}

macro_rules! domain_errors {
    ($($ty:ty),* $(,)?) => { $(impl From<$ty> for ApiError {
        fn from(error: $ty) -> Self { Self::from_domain(&error) }
    })* };
}
domain_errors!(
    crate::input_error::InputError,
    mainframe_chat::chat_manager::DiscardError,
);

impl From<mainframe_services::workspace::ScopeError> for ApiError {
    fn from(error: mainframe_services::workspace::ScopeError) -> Self {
        use mainframe_services::workspace::ScopeError;
        match error {
            ScopeError::Database(error) => error.into(),
            ScopeError::ChatNotFound => Self::chat_not_found(),
            ScopeError::WorktreeMissing(_) => Self::NotFound("Worktree missing".into()),
            ScopeError::ProjectNotFound | ScopeError::CrossProject => Self::project_not_found(),
        }
    }
}
