use crate::DatabaseManager;
use mainframe_types::{
    external_mcp::{CreateExternalMcpClient, ExternalMcpAccess},
    settings::ExecutionMode,
};

#[test]
fn credentials_survive_restart_and_revocation_removes_access() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");
    let db = DatabaseManager::open(&path).unwrap();
    let input = CreateExternalMcpClient {
        name: "Voice".into(),
        project_ids: vec!["p".into()],
        access: ExternalMcpAccess::Control,
        max_permission_mode: ExecutionMode::AcceptEdits,
    };
    let client = db.external_mcp.create(&input, &[7; 32]).unwrap();
    drop(db);
    let db = DatabaseManager::open(&path).unwrap();
    let authenticated = db.external_mcp.authenticate(&[7; 32]).unwrap().unwrap();
    assert_eq!(authenticated.id, client.id);
    assert_eq!(authenticated.project_ids, vec!["p"]);
    assert_eq!(
        authenticated.max_permission_mode,
        ExecutionMode::AcceptEdits
    );
    assert!(db.external_mcp.authenticate(&[8; 32]).unwrap().is_none());
    assert!(db.external_mcp.list().unwrap()[0].last_used_at.is_some());
    db.external_mcp.revoke(&client.id).unwrap();
    drop(db);
    let db = DatabaseManager::open(&path).unwrap();
    assert!(db.external_mcp.authenticate(&[7; 32]).unwrap().is_none());
    assert!(db.external_mcp.list().unwrap().is_empty());
}

#[test]
fn upgrades_an_existing_database_without_losing_projects() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    crate::migrations::run_migrations(&conn, 33).unwrap();
    conn.execute("INSERT INTO projects (id,name,path,created_at,last_opened_at) VALUES ('p','Kept','/tmp/kept','now','now')",[]).unwrap();
    drop(conn);
    let db = DatabaseManager::open(&path).unwrap();
    assert_eq!(db.projects.get("p").unwrap().unwrap().name, "Kept");
    assert!(db.external_mcp.list().unwrap().is_empty());
}
