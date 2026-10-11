use super::*;

#[derive(Debug, Clone)]
pub struct ForkCreateInput {
    pub parent_chat_id: String,
    pub project_id: String,
    pub adapter_id: String,
    pub model: Option<String>,
    pub permission_mode: Option<ExecutionMode>,
    pub plan_mode: bool,
    pub effort: Option<EffortLevel>,
    pub fast: Option<bool>,
    pub ultracode: Option<bool>,
    pub adaptive_thinking: Option<bool>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub title: Option<String>,
    pub pending_fork: PendingFork,
    /// A multi-segment parent's segments, as the fork copies them. `None`
    /// gives the fork one initial segment.
    pub segments: Option<mainframe_types::segment::ForkPlan>,
}

impl ForkCreateInput {
    pub fn as_insert(&self) -> ForkInsert<'_> {
        ForkInsert {
            parent_chat_id: &self.parent_chat_id,
            project_id: &self.project_id,
            adapter_id: &self.adapter_id,
            model: self.model.as_deref(),
            permission_mode: self.permission_mode,
            plan_mode: self.plan_mode,
            effort: self.effort,
            fast: self.fast,
            ultracode: self.ultracode,
            adaptive_thinking: self.adaptive_thinking,
            worktree_path: self.worktree_path.as_deref(),
            branch_name: self.branch_name.as_deref(),
            title: self.title.as_deref(),
            pending_fork: &self.pending_fork,
            segments: self.segments.as_ref(),
        }
    }
}
