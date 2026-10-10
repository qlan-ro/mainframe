use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::{Server, StatusCode};
use crate::routes::mcp::MCP_BODY_LIMIT_BYTES;

#[tokio::test]
async fn oversized_mcp_request_is_rejected_before_upload() {
    let server = Server::start().await;
    let (_, token) = server.caller().await;
    let addr = server
        .base
        .strip_prefix("http://")
        .unwrap()
        .trim_end_matches("/mcp");
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    let request = format!(
        "POST /mcp HTTP/1.1\r\nHost: {addr}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
        MCP_BODY_LIMIT_BYTES + 1
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut status_line = String::new();
    BufReader::new(stream)
        .read_line(&mut status_line)
        .await
        .unwrap();
    assert_eq!(status_line, "HTTP/1.1 413 Payload Too Large\r\n");
}

#[tokio::test]
async fn oversized_mcp_body_is_rejected_after_authentication() {
    let server = Server::start().await;
    let (_, token) = server.caller().await;
    let request = axum::http::Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from("x".repeat(MCP_BODY_LIMIT_BYTES + 1)))
        .unwrap();
    let response = super::super::handle(axum::extract::State(server.ctx), request).await;
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}
