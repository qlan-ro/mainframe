use crate::{AppCtx, Db};
use std::sync::Arc;

pub(crate) fn build_test_context() -> Arc<AppCtx> {
    let db = Db::spawn(|| mainframe_db::DatabaseManager::open(std::path::Path::new(":memory:")))
        .expect("in-memory database");
    Arc::new(
        AppCtx::test_builder(
            db,
            std::env::temp_dir().join(format!("mf-routes-test-{}", nanoid::nanoid!())),
        )
        .build()
        .unwrap(),
    )
}
