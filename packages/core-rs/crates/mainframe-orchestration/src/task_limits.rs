//! How many delegated tasks may be open at once, per parent chat and per
//! delegation tree.

use std::collections::HashMap;

use mainframe_types::orchestration::DelegatedTask;

use crate::errors::{ErrorCode, ToolError};
use crate::policy::{MAX_ACTIVE_TASKS_PER_PARENT, MAX_ACTIVE_TASKS_PER_TREE, MAX_DEPTH};
use crate::service::OrchestrationService;

/// Every open (nonterminal) task, as child → parent edges.
struct OpenTasks {
    parent_of: HashMap<String, String>,
}

impl OpenTasks {
    fn new(open: Vec<DelegatedTask>) -> Self {
        Self {
            parent_of: open
                .into_iter()
                .map(|t| (t.child_chat_id, t.parent_chat_id))
                .collect(),
        }
    }

    /// The chat where `chat_id`'s chain of open tasks starts; `chat_id` itself
    /// when no open task runs in it.
    fn root_of<'a>(&'a self, chat_id: &'a str) -> &'a str {
        let mut root = chat_id;
        for _ in 0..=MAX_DEPTH {
            match self.parent_of.get(root) {
                Some(parent) => root = parent,
                None => break,
            }
        }
        root
    }

    fn of_parent(&self, parent_chat_id: &str) -> usize {
        self.parent_of
            .values()
            .filter(|parent| *parent == parent_chat_id)
            .count()
    }

    fn in_tree_of(&self, chat_id: &str) -> usize {
        let root = self.root_of(chat_id);
        self.parent_of
            .values()
            .filter(|parent| self.root_of(parent) == root)
            .count()
    }
}

impl OrchestrationService {
    async fn open_tasks(&self) -> Result<OpenTasks, ToolError> {
        Ok(OpenTasks::new(self.tasks.nonterminal().await?))
    }

    /// Open tasks in the tree rooted where `chat_id`'s delegation chain starts.
    pub(crate) async fn open_tasks_in_tree(&self, chat_id: &str) -> Result<usize, ToolError> {
        Ok(self.open_tasks().await?.in_tree_of(chat_id))
    }

    pub(crate) async fn check_task_limits(&self, caller_id: &str) -> Result<(), ToolError> {
        let open = self.open_tasks().await?;
        if open.of_parent(caller_id) >= MAX_ACTIVE_TASKS_PER_PARENT {
            return Err(limit_exceeded(format!(
                "At most {MAX_ACTIVE_TASKS_PER_PARENT} tasks may run per chat; wait for one to finish."
            )));
        }
        if open.in_tree_of(caller_id) >= MAX_ACTIVE_TASKS_PER_TREE {
            return Err(limit_exceeded(format!(
                "At most {MAX_ACTIVE_TASKS_PER_TREE} tasks may run in one delegation tree."
            )));
        }
        Ok(())
    }
}

fn limit_exceeded(message: String) -> ToolError {
    ToolError::new(ErrorCode::TaskLimitExceeded, message)
}
