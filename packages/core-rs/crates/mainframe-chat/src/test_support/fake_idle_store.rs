macro_rules! idle_store_methods {
    () => {
        fn idle_markers(
            &self,
            chat_id: &str,
        ) -> Result<Vec<mainframe_types::chat::ChatMessage>, SeamError> {
            let Some(db) = self.store.idle_db.get() else {
                return Ok(Vec::new());
            };
            let chat_id = chat_id.to_owned();
            db.call_blocking(move |d| {
                mainframe_db::idle_compaction::markers(d.connection(), &chat_id)
            })
            .map_err(SeamError::new)
        }
        fn idle_commands(
            &self,
            chat_id: &str,
        ) -> Result<Vec<mainframe_types::compaction::NativeCompactionRequest>, SeamError> {
            let Some(db) = self.store.idle_db.get() else {
                return Ok(Vec::new());
            };
            let chat_id = chat_id.to_owned();
            db.call_blocking(move |d| {
                mainframe_db::idle_compaction::commands(d.connection(), &chat_id)
            })
            .map_err(SeamError::new)
        }
        fn idle_queue_put(
            &self,
            chat_id: &str,
            input: &mainframe_db::idle_compaction_queue::QueuedInput,
        ) -> Result<(), SeamError> {
            let Some(db) = self.store.idle_db.get() else {
                return Ok(());
            };
            let (chat_id, input) = (chat_id.to_owned(), input.clone());
            db.call_blocking(move |d| {
                mainframe_db::idle_compaction_queue::put(d.connection(), &chat_id, &input)
            })
            .map_err(SeamError::new)
        }
        fn idle_queue_list(
            &self,
            chat_id: &str,
        ) -> Result<Vec<mainframe_db::idle_compaction_queue::QueuedInput>, SeamError> {
            let Some(db) = self.store.idle_db.get() else {
                return Ok(Vec::new());
            };
            let chat_id = chat_id.to_owned();
            db.call_blocking(move |d| {
                mainframe_db::idle_compaction_queue::list(d.connection(), &chat_id)
            })
            .map_err(SeamError::new)
        }
        fn idle_queue_remove(&self, chat_id: &str, uuid: &str) -> Result<bool, SeamError> {
            let Some(db) = self.store.idle_db.get() else {
                return Ok(false);
            };
            let (chat_id, uuid) = (chat_id.to_owned(), uuid.to_owned());
            db.call_blocking(move |d| {
                mainframe_db::idle_compaction_queue::remove(d.connection(), &chat_id, &uuid)
            })
            .map_err(SeamError::new)
        }
        fn idle_run_begin(&self, chat_id: &str, generation: &str) -> Result<(), SeamError> {
            let Some(db) = self.store.idle_db.get() else {
                return Ok(());
            };
            let (chat_id, generation) = (chat_id.to_owned(), generation.to_owned());
            db.call_blocking(move |d| {
                mainframe_db::idle_compaction::begin(d.connection(), &chat_id, &generation)
            })
            .map_err(SeamError::new)
        }
        fn idle_run_complete(
            &self,
            chat_id: &str,
            generation: &str,
            at: Option<i64>,
        ) -> Result<(), SeamError> {
            let Some(db) = self.store.idle_db.get() else {
                return Ok(());
            };
            let (chat_id, generation) = (chat_id.to_owned(), generation.to_owned());
            db.call_blocking(move |d| {
                mainframe_db::idle_compaction::complete(d.connection(), &chat_id, &generation, at)
            })
            .map_err(SeamError::new)
        }
        fn idle_run_get(
            &self,
            chat_id: &str,
        ) -> Result<Option<mainframe_db::idle_compaction::RealRun>, SeamError> {
            let Some(db) = self.store.idle_db.get() else {
                return Ok(None);
            };
            let chat_id = chat_id.to_owned();
            db.call_blocking(move |d| mainframe_db::idle_compaction::get(d.connection(), &chat_id))
                .map_err(SeamError::new)
        }
        fn idle_run_claim(
            &self,
            chat_id: &str,
            generation: &str,
            request: &mainframe_types::compaction::NativeCompactionRequest,
        ) -> Result<bool, SeamError> {
            let Some(db) = self.store.idle_db.get() else {
                return Ok(false);
            };
            let (chat_id, generation, request) =
                (chat_id.to_owned(), generation.to_owned(), request.clone());
            let result = db
                .call_blocking(move |d| {
                    mainframe_db::idle_compaction::claim(
                        d.connection(),
                        &chat_id,
                        &generation,
                        &request,
                    )
                })
                .map_err(SeamError::new);
            if let Some(hook) = self.store.idle_claim_hook.lock_recover().as_ref() {
                hook();
            }
            result
        }
        fn idle_record(
            &self,
            chat_id: &str,
            metadata: &mainframe_types::compaction::CompactionMetadata,
        ) -> Result<bool, SeamError> {
            let Some(db) = self.store.idle_db.get() else {
                return Ok(false);
            };
            let (chat_id, metadata) = (chat_id.to_owned(), metadata.clone());
            db.call_blocking(move |d| {
                mainframe_db::idle_compaction::record(d.connection(), &chat_id, &metadata)
            })
            .map_err(SeamError::new)
        }
        fn idle_provenance(
            &self,
            chat_id: &str,
        ) -> Result<Vec<mainframe_types::compaction::CompactionMetadata>, SeamError> {
            let Some(db) = self.store.idle_db.get() else {
                return Ok(Vec::new());
            };
            let chat_id = chat_id.to_owned();
            db.call_blocking(move |d| {
                mainframe_db::idle_compaction::provenance(d.connection(), &chat_id)
            })
            .map_err(SeamError::new)
        }
    };
}
pub(crate) use idle_store_methods;
