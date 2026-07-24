//! The [`Sink`] that turns matched lines into [`SearchContentResult`]s — one
//! result per matched line, column from the matcher's own first-match offset
//! (mirrors the old `rg --json` output's `submatches[0]`).

use grep_matcher::Matcher;
use grep_regex::RegexMatcher;
use grep_searcher::{Searcher, Sink, SinkMatch};
use mainframe_types::search::SearchContentResult;

const MAX_LINE_LENGTH: usize = 500;
/// Per-file match cap, mirrors the old CLI's `--max-count 50`.
const PER_FILE_LIMIT: usize = 50;

pub(super) struct ContentSink<'a> {
    pub(super) matcher: &'a RegexMatcher,
    pub(super) rel_file: &'a str,
    pub(super) results: &'a mut Vec<SearchContentResult>,
    pub(super) max_results: usize,
    pub(super) hits_in_file: usize,
}

impl Sink for ContentSink<'_> {
    type Error = std::io::Error;

    fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        if self.results.len() >= self.max_results || self.hits_in_file >= PER_FILE_LIMIT {
            return Ok(false);
        }

        let raw = String::from_utf8_lossy(mat.bytes()).into_owned();
        let text: String = raw
            .strip_suffix('\n')
            .unwrap_or(&raw)
            .chars()
            .take(MAX_LINE_LENGTH)
            .collect();
        let column = self
            .matcher
            .find(mat.bytes())
            .ok()
            .flatten()
            .map(|m| m.start())
            .unwrap_or(0);

        self.results.push(SearchContentResult {
            file: self.rel_file.to_string(),
            line: mat.line_number().unwrap_or(0) as i64,
            column: column as i64 + 1,
            text,
        });
        self.hits_in_file += 1;
        Ok(true)
    }
}
