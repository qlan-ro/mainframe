use super::*;
use tokio::io::{AsyncBufReadExt, BufReader};

#[tokio::test]
async fn close_stops_a_helper_that_ignores_term_after_its_parent_exits() {
    let mut command = tokio::process::Command::new("/bin/sh");
    command
        .process_group(0)
        .kill_on_drop(true)
        .stdout(std::process::Stdio::piped())
        .args([
            "-c",
            r#"trap 'exit 0' TERM
/bin/sh -c 'trap "" TERM; echo ready; while :; do sleep 1; done' &
wait"#,
        ]);
    let mut child = command.spawn().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap()).lines();
    let client = JsonRpcClient::new(
        child,
        JsonRpcHandlers {
            on_notification: Box::new(|_, _| {}),
            on_request: Box::new(|_, _, _| {}),
            on_error: Box::new(|_| {}),
            on_exit: Box::new(|_| {}),
        },
    );
    let ready = tokio::time::timeout(Duration::from_secs(2), stdout.next_line()).await;
    client.close();
    tokio::time::timeout(Duration::from_secs(3), client.closed())
        .await
        .unwrap();
    assert_eq!(ready.unwrap().unwrap().as_deref(), Some("ready"));
    let end = tokio::time::timeout(Duration::from_secs(2), stdout.next_line())
        .await
        .unwrap();
    assert_eq!(end.unwrap(), None, "helper stdout should close");
}
