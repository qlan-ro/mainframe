/// Shared baseline: reqwest defaults, with no total timeout or User-Agent.
/// Callers retain protocol-specific headers and request deadlines; downloads
/// and device polling must not inherit an arbitrary global deadline.
pub fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
}

pub fn client() -> Result<reqwest::Client, reqwest::Error> {
    builder().build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn default_headers_and_explicit_policy_are_preserved() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = [0; 2048];
                let count = stream.read(&mut bytes).await.unwrap();
                requests.push(String::from_utf8_lossy(&bytes[..count]).to_lowercase());
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                    )
                    .await
                    .unwrap();
            }
            requests
        });
        let url = format!("http://{address}/");
        assert_eq!(
            client()
                .unwrap()
                .get(&url)
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "ok"
        );
        builder()
            .user_agent("test-agent")
            .timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap()
            .get(&url)
            .send()
            .await
            .unwrap();
        let requests = server.await.unwrap();
        assert!(!requests[0].contains("user-agent:"));
        assert!(requests[1].contains("user-agent: test-agent\r\n"));
    }
}
