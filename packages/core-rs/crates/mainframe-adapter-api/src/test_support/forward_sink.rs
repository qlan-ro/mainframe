#[macro_export]
macro_rules! forward_session_sink {
    ($($method:ident),* $(,)?) => {
        $($crate::forward_session_sink!(@forward self => &$crate::test_support::NullSink; $method);)*
    };
    ($this:ident => $target:expr; $($method:ident),* $(,)?) => {
        $($crate::forward_session_sink!(@forward $this => $target; $method);)*
    };
    (@forward $this:ident => $target:expr; on_init) => {
        fn on_init(&$this, session_id: &str) {
            $crate::SessionSink::on_init($target, session_id);
        }
    };
    (@forward $this:ident => $target:expr; on_message) => {
        fn on_message(&$this, content: Vec<mainframe_types::chat::MessageContent>, metadata: Option<mainframe_types::adapter::MessageMetadata>) {
            $crate::SessionSink::on_message($target, content, metadata);
        }
    };
    (@forward $this:ident => $target:expr; on_tool_result) => {
        fn on_tool_result(&$this, content: Vec<mainframe_types::chat::MessageContent>, vendor_id: Option<String>) {
            $crate::SessionSink::on_tool_result($target, content, vendor_id);
        }
    };
    (@forward $this:ident => $target:expr; on_permission) => {
        fn on_permission(&$this, request: $crate::ControlRequest) {
            $crate::SessionSink::on_permission($target, request);
        }
    };
    (@forward $this:ident => $target:expr; on_result) => {
        fn on_result(&$this, data: mainframe_types::adapter::SessionResult) {
            $crate::SessionSink::on_result($target, data);
        }
    };
    (@forward $this:ident => $target:expr; on_exit) => {
        fn on_exit(&$this, code: Option<i32>) {
            $crate::SessionSink::on_exit($target, code);
        }
    };
    (@forward $this:ident => $target:expr; on_error) => {
        fn on_error(&$this, error: $crate::AdapterError) {
            $crate::SessionSink::on_error($target, error);
        }
    };
    (@forward $this:ident => $target:expr; on_compact) => {
        fn on_compact(&$this, vendor_id: Option<&str>) {
            $crate::SessionSink::on_compact($target, vendor_id);
        }
    };
    (@forward $this:ident => $target:expr; on_compact_start) => {
        fn on_compact_start(&$this) {
            $crate::SessionSink::on_compact_start($target);
        }
    };
    (@forward $this:ident => $target:expr; on_context_usage) => {
        fn on_context_usage(&$this, usage: mainframe_types::adapter::ContextUsage) {
            $crate::SessionSink::on_context_usage($target, usage);
        }
    };
    (@forward $this:ident => $target:expr; on_plan_file) => {
        fn on_plan_file(&$this, file_path: &str) {
            $crate::SessionSink::on_plan_file($target, file_path);
        }
    };
    (@forward $this:ident => $target:expr; on_skill_file) => {
        fn on_skill_file(&$this, entry: mainframe_types::context::SkillFileEntry) {
            $crate::SessionSink::on_skill_file($target, entry);
        }
    };
    (@forward $this:ident => $target:expr; on_queued_processed) => {
        fn on_queued_processed(&$this, uuid: &str) {
            $crate::SessionSink::on_queued_processed($target, uuid);
        }
    };
    (@forward $this:ident => $target:expr; on_todo_update) => {
        fn on_todo_update(&$this, todos: Vec<mainframe_types::chat::TodoItem>) {
            $crate::SessionSink::on_todo_update($target, todos);
        }
    };
    (@forward $this:ident => $target:expr; on_pr_detected) => {
        fn on_pr_detected(&$this, pr: mainframe_types::adapter::DetectedPr) {
            $crate::SessionSink::on_pr_detected($target, pr);
        }
    };
    (@forward $this:ident => $target:expr; on_cli_message) => {
        fn on_cli_message(&$this, text: &str) {
            $crate::SessionSink::on_cli_message($target, text);
        }
    };
    (@forward $this:ident => $target:expr; on_skill_loaded) => {
        fn on_skill_loaded(&$this, entry: $crate::LoadedSkill) {
            $crate::SessionSink::on_skill_loaded($target, entry);
        }
    };
    (@forward $this:ident => $target:expr; on_subagent_child) => {
        fn on_subagent_child(&$this, parent_tool_use_id: &str, blocks: Vec<mainframe_types::chat::MessageContent>) {
            $crate::SessionSink::on_subagent_child($target, parent_tool_use_id, blocks);
        }
    };
}
