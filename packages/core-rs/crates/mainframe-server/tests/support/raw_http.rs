//! Raw-TCP request helper for the over-limit body-limit test. `reqwest` cannot
//! be used there: the server answers `413` and closes without draining the
//! request, so a `reqwest` send races between returning the response and
//! failing mid-write with `EPIPE`.

use std::net::SocketAddr;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub struct RawResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// POST `body` to `path` over a raw socket and return the parsed response,
/// reading exactly the declared `Content-Length` and never to EOF (the
/// server's early close delivers an RST past the buffered response).
pub async fn post_raw(addr: SocketAddr, path: &str, body: Vec<u8>) -> RawResponse {
    let stream = TcpStream::connect(addr).await.unwrap();
    let (mut reader, mut writer) = tokio::io::split(stream);

    let head = format!(
        "POST {path} HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n",
        len = body.len()
    );

    tokio::spawn(async move {
        // The server may answer 413 and close the connection before the body
        // finishes sending — a write error here is the expected shape of a
        // working limit layer, not a test failure.
        let _ = writer.write_all(head.as_bytes()).await;
        for chunk in body.chunks(64 * 1024) {
            if writer.write_all(chunk).await.is_err() {
                break;
            }
        }
    });

    tokio::time::timeout(Duration::from_secs(10), read_response(&mut reader))
        .await
        .expect("no response before the body finished sending")
}

async fn read_response(reader: &mut (impl AsyncReadExt + Unpin)) -> RawResponse {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        reader.read_exact(&mut byte).await.unwrap();
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let headers: Vec<(String, String)> = lines
        .filter(|l| !l.is_empty())
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();

    let content_length: usize = headers
        .iter()
        .find(|(k, _)| k == "content-length")
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body).await.unwrap();
    }

    RawResponse {
        status,
        headers,
        body,
    }
}
