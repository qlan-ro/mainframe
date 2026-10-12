use super::DaemonEvent;

impl DaemonEvent {
    pub fn chat_id(&self) -> Option<&str> {
        match self {
            Self::ChatEnded { chat_id, .. }
            | Self::ChatOffloaded { chat_id, .. }
            | Self::ProcessStarted { chat_id, .. }
            | Self::ContextUpdated { chat_id, .. }
            | Self::ChatNotification { chat_id, .. }
            | Self::TodosUpdated { chat_id, .. }
            | Self::ChatPrDetected { chat_id, .. }
            | Self::WorktreeOfferRaised { chat_id, .. }
            | Self::WorktreeOfferResolved { chat_id, .. }
            | Self::WorktreeOfferSnapshot { chat_id, .. }
            | Self::ChatTrustRequired { chat_id, .. }
            | Self::SubscribeAck { chat_id, .. }
            | Self::BackgroundTaskStarted { chat_id, .. }
            | Self::BackgroundTaskUpdated { chat_id, .. }
            | Self::BackgroundTaskEnded { chat_id, .. }
            | Self::ClaudeWorkflowRunUpdated { chat_id, .. } => Some(chat_id),
            Self::Error { chat_id, .. } => chat_id.as_deref(),
            Self::ConnectionReady { .. }
            | Self::ChatCreated { .. }
            | Self::ChatUpdated { .. }
            | Self::DelegatedTaskUpdated { .. }
            | Self::ProcessReady { .. }
            | Self::ProcessStopped { .. }
            | Self::PluginPanelRegistered { .. }
            | Self::PluginPanelUnregistered { .. }
            | Self::PluginActionRegistered { .. }
            | Self::PluginActionUnregistered { .. }
            | Self::PluginNotification { .. }
            | Self::LaunchOutput { .. }
            | Self::LaunchStatus { .. }
            | Self::LaunchTunnel { .. }
            | Self::LaunchTunnelFailed { .. }
            | Self::LaunchPortTimeout { .. }
            | Self::LaunchScopeReleased { .. }
            | Self::SessionsExternalCount { .. }
            | Self::AdapterModelsUpdated { .. }
            | Self::ProviderQuotaUpdated { .. }
            | Self::TunnelStatus { .. }
            | Self::FileChanged { .. }
            | Self::SubscribeFileAck { .. }
            | Self::AutomationRunUpdated { .. }
            | Self::AutomationInteractionCreated { .. }
            | Self::AutomationInteractionResolved { .. }
            | Self::AutomationCompleted { .. }
            | Self::AutomationNotification { .. }
            | Self::NotificationCreated { .. } => None,
        }
    }
    pub fn is_connection_global(&self) -> bool {
        matches!(
            self,
            Self::ChatNotification { .. }
                | Self::AutomationNotification { .. }
                | Self::ChatOffloaded { .. }
        )
    }
}
