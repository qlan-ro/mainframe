use super::*;

pub trait ChatManagerDeps:
    ChatStore + ProjectPaths + EventEmitter + Pusher + AdapterPort + WorkspacePort
{
    fn settings(&self) -> &dyn mainframe_types::settings_kv::SettingsKv;
}
