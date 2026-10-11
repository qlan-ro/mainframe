use crate::BoxFuture;
use mainframe_types::adapter::ExternalSessionPage;

pub trait ExternalSessions: Send + Sync {
    fn list(
        &self,
        project: String,
        exclude: Vec<String>,
        offset: i64,
        limit: i64,
    ) -> BoxFuture<'_, ExternalSessionPage>;
}
