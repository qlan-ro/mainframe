use super::*;

pub(super) fn notification_gate(host_db: Arc<dyn PluginHostDb>) -> crate::ui_context::NotifyGate {
    Box::new(move || {
        let host_db = host_db.clone();
        Box::pin(async move {
            let raw = mainframe_services::settings::read_setting(
                host_db.settings(),
                "general",
                "notifications",
            )
            .await;
            mainframe_services::notifications::parse_notification_config(raw.as_deref())
                .other
                .plugin
        })
    })
}
