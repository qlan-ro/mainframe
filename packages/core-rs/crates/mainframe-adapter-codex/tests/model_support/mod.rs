#![allow(dead_code)]
use mainframe_adapter_api::AdapterSession;
use mainframe_adapter_codex::CodexSession;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{ForkSource, SessionOptions, SessionSpawnOptions};
use serde_json::Value;
use std::{fs, os::unix::fs::PermissionsExt, sync::Arc};

pub struct Fixture {
    dir: tempfile::TempDir,
}
impl Fixture {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let capture = serde_json::to_string(&dir.path().join("capture.jsonl").to_str()).unwrap();
        let script = format!(
            r#"#!/usr/bin/python3
import json,sys,os
model = 'cli-configured'
for line in sys.stdin:
    with open({capture},'a') as capture: capture.write(line)
    req = json.loads(line)
    if 'id' not in req: continue
    method,params = req['method'],req.get('params',{{}})
    if method == 'initialize' and os.path.exists('handshake-error'):
        with open('probe.pid','w') as pid: pid.write(str(os.getpid()))
        print(json.dumps({{'id':req['id'],'error':{{'message':'handshake rejected'}}}}),flush=True)
        continue
    result = {{}}
    if method == 'config/read': result = {{'config':{{'model':None if os.path.exists('no-config') else 'cli-configured'}}}}
    if method in ('thread/start','thread/resume','thread/fork'):
        model = params.get('model') or ('old-session-model' if method != 'thread/start' else ('cli-native' if os.path.exists('no-config') else 'cli-configured'))
        result = {{'thread':{{'id':'thread-1','forkedFromId':'parent-thread' if method == 'thread/fork' else None}},'model':model}}
    if method in ('thread/start','thread/resume') and os.path.exists('missing-model'): result.pop('model', None)
    if method == 'thread/read': result = {{'thread':{{'id':'thread-1','model':model}}}}
    if method == 'turn/start':
        model = params.get('model') or params['collaborationMode']['settings']['model']
        result = {{'turn':{{'id':'turn-1','status':'inProgress'}}}}
    print(json.dumps({{'id':req['id'],'result':result}}),flush=True)
"#
        );
        let exe = dir.path().join("codex");
        fs::write(&exe, script).unwrap();
        fs::set_permissions(exe, fs::Permissions::from_mode(0o755)).unwrap();
        Self { dir }
    }
    pub fn project(&self) -> String {
        self.dir.path().to_string_lossy().into_owned()
    }
    pub fn executable(&self) -> String {
        self.dir.path().join("codex").to_string_lossy().into_owned()
    }
    pub fn requests(&self) -> Vec<Value> {
        fs::read_to_string(self.dir.path().join("capture.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }
    pub async fn session(&self, model: &str, resume: bool) -> CodexSession {
        self.start(model, resume, false, None).await
    }
    pub async fn fork_session(&self, model: &str) -> CodexSession {
        self.start(model, false, true, None).await
    }
    pub async fn session_with_hint(&self, model: &str, hint: &str) -> CodexSession {
        self.start(model, false, false, Some(hint)).await
    }
    async fn start(
        &self,
        model: &str,
        resume: bool,
        fork: bool,
        hint: Option<&str>,
    ) -> CodexSession {
        let session = CodexSession::new(
            SessionOptions {
                project_path: self.project(),
                chat_id: resume.then(|| "thread-1".into()),
                mainframe_chat_id: "chat-1".into(),
                session_file_path: None,
                fork_source: fork.then(|| ForkSource {
                    source_session_id: "parent-thread".into(),
                    resume_path: None,
                    last_turn_id: None,
                }),
            },
            None,
            ResolvedPath::from_value("/usr/bin:/bin"),
            Arc::new(BackgroundTaskTracker::new()),
        );
        session.set_transcript_present_override(resume);
        session
            .spawn(
                Some(SessionSpawnOptions {
                    model: Some(model.into()),
                    executable_path: Some(self.executable()),
                    permission_mode: None,
                    plan_mode: None,
                    system_prompt: None,
                    tuning: None,
                    small_fast_model: None,
                    default_model: hint.map(str::to_owned),
                    no_persistence: None,
                    orchestration_mcp: None,
                }),
                None,
            )
            .await
            .unwrap();
        session
    }
}
