pub(super) async fn open_lines(path: &str) -> Option<Vec<u8>> {
    read_bytes(path, false).await
}

pub(super) async fn first_record(path: &str) -> Option<Vec<u8>> {
    read_bytes(path, true).await
}

async fn read_bytes(path: &str, header_only: bool) -> Option<Vec<u8>> {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || {
        use std::io::{BufRead, BufReader, Read};
        let mut file = std::fs::File::open(path).ok()?;
        if header_only {
            let mut reader = BufReader::new(file);
            let mut line = Vec::new();
            loop {
                line.clear();
                if reader.read_until(b'\n', &mut line).ok()? == 0 {
                    return None;
                }
                if !std::str::from_utf8(&line).ok()?.trim().is_empty() {
                    return Some(line);
                }
            }
        }
        let mut bytes = Vec::with_capacity(file.metadata().ok().map_or(0, |m| m.len() as usize));
        if file.read_to_end(&mut bytes).is_err() {
            bytes.truncate(bytes.iter().rposition(|&b| b == b'\n').map_or(0, |p| p + 1));
        }
        Some(bytes)
    })
    .await
    .ok()
    .flatten()
}

pub(super) fn valid_lines(bytes: &[u8]) -> impl Iterator<Item = &str> {
    bytes
        .split(|&byte| byte == b'\n')
        .map_while(|line| std::str::from_utf8(line).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::path::Path;
    use tokio::io::{AsyncBufReadExt, BufReader};

    async fn compare(path: &Path) {
        let data = open_lines(path.to_str().unwrap()).await.unwrap();
        let actual: Vec<Value> = valid_lines(&data)
            .filter_map(|line| serde_json::from_slice(line.as_bytes()).ok())
            .collect();
        let mut old = BufReader::new(tokio::fs::File::open(path).await.unwrap()).lines();
        let mut expected = Vec::<Value>::new();
        while let Ok(Some(line)) = old.next_line().await {
            if let Ok(record) = serde_json::from_str(&line) {
                expected.push(record);
            }
        }
        assert_eq!(actual, expected);
    }

    #[tokio::test]
    async fn agrees_with_streaming_reader_at_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample");
        assert!(open_lines(path.to_str().unwrap()).await.is_none());
        for size in [8191, 8192, 8193, 100_000] {
            for tail in [b"42".as_slice(), b"{", b"\xff\n42", b"\xef\xbb\xbf{}\n42"] {
                let mut bytes = vec![b' '; size];
                bytes.extend_from_slice(b"1\r\n\ninvalid\n2\n");
                bytes.extend_from_slice(tail);
                std::fs::write(&path, bytes).unwrap();
                compare(&path).await;
            }
        }
        std::fs::write(&path, []).unwrap();
        compare(&path).await;
    }

    #[tokio::test]
    async fn agrees_with_streaming_reader_on_fixtures() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        compare(
            &root.join("../mainframe-server/tests/fixtures/golden-session-with-tool-calls.jsonl"),
        )
        .await;
        let fixtures = root.join("src/__fixtures__");
        for entry in std::fs::read_dir(fixtures).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|ext| ext == "jsonl") {
                compare(&path).await;
            }
        }
    }
}
