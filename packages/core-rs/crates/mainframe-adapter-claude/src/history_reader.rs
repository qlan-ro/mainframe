use std::io::{BufRead, BufReader};

pub(super) const CHUNK_SIZE: usize = 1024 * 1024;

pub(super) async fn first_record(path: &str) -> Option<Vec<u8>> {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(path).ok()?;
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
    })
    .await
    .ok()
    .flatten()
}

pub(super) fn open_reader(path: &str) -> std::io::Result<BufReader<std::fs::File>> {
    #[cfg(test)]
    OPENED_PATHS.with(|paths| paths.borrow_mut().push(path.to_owned()));
    Ok(BufReader::with_capacity(
        CHUNK_SIZE,
        std::fs::File::open(path)?,
    ))
}

pub(super) fn visit_lines(path: &str, visit: impl FnMut(&str)) -> std::io::Result<()> {
    read_chunks(open_reader(path)?, visit)
}

pub(super) fn read_chunks(
    mut reader: impl BufRead,
    mut visit: impl FnMut(&str),
) -> std::io::Result<()> {
    let mut carry = Vec::new();
    loop {
        let bytes = reader.fill_buf()?;
        if bytes.is_empty() {
            if !carry.is_empty()
                && let Ok(line) = std::str::from_utf8(&carry)
            {
                visit(line);
            }
            return Ok(());
        }
        let mut lines = bytes.split(|&b| b == b'\n').peekable();
        while let Some(part) = lines.next() {
            if lines.peek().is_none() {
                carry.extend_from_slice(part);
                break;
            }
            let line = if carry.is_empty() {
                part
            } else {
                carry.extend_from_slice(part);
                &carry
            };
            let Ok(line) = std::str::from_utf8(line) else {
                return Ok(());
            };
            visit(line.strip_suffix('\r').unwrap_or(line));
            carry.clear();
            if carry.capacity() > CHUNK_SIZE {
                carry = Vec::new();
            }
        }
        let consumed = bytes.len();
        reader.consume(consumed);
    }
}

#[cfg(test)]
thread_local! {
    static OPENED_PATHS: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
pub(super) fn take_opened_paths() -> Vec<String> {
    OPENED_PATHS.with(|paths| std::mem::take(&mut *paths.borrow_mut()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tokio::io::{AsyncBufReadExt, BufReader};

    async fn compare(path: &Path) {
        let mut actual = Vec::<String>::new();
        read_chunks(
            std::io::BufReader::with_capacity(8, std::fs::File::open(path).unwrap()),
            |line| actual.push(line.to_owned()),
        )
        .unwrap();
        let mut old = BufReader::new(tokio::fs::File::open(path).await.unwrap()).lines();
        let mut expected = Vec::<String>::new();
        while let Ok(Some(line)) = old.next_line().await {
            expected.push(line);
        }
        assert_eq!(actual, expected);
    }

    #[tokio::test]
    async fn agrees_with_streaming_reader_at_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample");
        assert!(
            visit_lines(path.to_str().unwrap(), |_| {
                panic!("missing file yielded a line")
            })
            .is_err()
        );
        std::fs::write(&path, "      \"é\"").unwrap();
        compare(&path).await;
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
