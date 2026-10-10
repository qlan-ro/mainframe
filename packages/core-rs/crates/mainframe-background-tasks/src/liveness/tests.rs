use super::*;
use crate::lsof::{ExecFn, ExecOk, set_exec_for_tests};
use crate::tracker::TaskSeed;
use mainframe_types::background_task::{BackgroundTaskToolName, BackgroundWorkKind};
use std::sync::atomic::{AtomicUsize, Ordering};

fn seed_running(tracker: &BackgroundTaskTracker, chat_id: &str, id: &str, output_path: &str) {
    tracker.start(
        chat_id,
        TaskSeed {
            id: id.to_string(),
            kind: BackgroundWorkKind::Bash,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: "u".to_string(),
            command: "x".to_string(),
            description: String::new(),
            workflow_name: None,
        },
        output_path.to_string(),
    );
}

/// lsof seam producing writers `pids` (write-mode 'aw' lines).
fn writers_exec(pids: &'static [u32]) -> ExecFn {
    Arc::new(move |_cmd, _args| {
        let mut stdout = String::new();
        for p in pids {
            stdout.push_str(&format!("p{p}\naw\nn/p\n"));
        }
        Box::pin(async move { Ok(ExecOk { stdout }) })
    })
}

use mainframe_types::time::now_ms;

mod ticks;
