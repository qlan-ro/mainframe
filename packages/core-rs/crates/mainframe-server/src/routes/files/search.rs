use serde::Serialize;

use super::basename;
use crate::fs_utils::has_binary_extension;

#[derive(Serialize)]
pub(super) struct FileHit {
    name: String,
    path: String,
    #[serde(rename = "type")]
    entry_type: &'static str,
}

pub(super) fn file_hit(rel: &str, query: &str) -> Option<(usize, FileHit)> {
    if has_binary_extension(rel) {
        return None;
    }
    let rel_lower = rel.to_lowercase();
    let name = basename(rel);
    let name_lower = name.to_lowercase();
    let stem = name_lower
        .rsplit_once('.')
        .map_or(name_lower.as_str(), |(stem, _)| stem);
    let rank = if stem == query {
        0
    } else if name_lower.starts_with(query) {
        1
    } else if name_lower.contains(query) {
        2
    } else if fuzzy_match(query, &name_lower) {
        3
    } else if rel_lower.contains(query) {
        4
    } else if fuzzy_match(query, &rel_lower) {
        5
    } else {
        return None;
    };
    Some((
        rank,
        FileHit {
            name,
            path: rel.to_string(),
            entry_type: "file",
        },
    ))
}

pub(super) fn fuzzy_match(query: &str, target: &str) -> bool {
    let q: Vec<char> = query.chars().collect();
    let mut qi = 0;
    for tc in target.chars() {
        if qi >= q.len() {
            break;
        }
        if tc == q[qi] {
            qi += 1;
        }
    }
    qi == q.len()
}
