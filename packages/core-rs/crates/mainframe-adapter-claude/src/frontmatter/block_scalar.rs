//! YAML block-scalar (`|`/`>`) reader for the hand-rolled frontmatter parser.
//! Scope: `|`, `|-`, `|+`, `>`, `>-`, `>+` only — explicit indentation
//! indicators (`|2`, `>4`) are out of scope and fall
//! back to `None`, which the caller treats as an inline scalar.

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Style {
    Literal,
    Folded,
}

/// Clip (YAML's unmarked default) is folded into `Strip` — a description is a
/// display string, so its one guaranteed trailing newline is noise every
/// consumer would otherwise have to trim.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Chomp {
    Strip,
    Keep,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Header {
    pub style: Style,
    pub chomp: Chomp,
}

/// `Some(header)` when `value` (the text after `key:`) is exactly one of the
/// six accepted block-scalar headers; anything else is an inline scalar.
pub(crate) fn parse_header(value: &str) -> Option<Header> {
    match value.trim() {
        "|" | "|-" => Some(Header {
            style: Style::Literal,
            chomp: Chomp::Strip,
        }),
        "|+" => Some(Header {
            style: Style::Literal,
            chomp: Chomp::Keep,
        }),
        ">" | ">-" => Some(Header {
            style: Style::Folded,
            chomp: Chomp::Strip,
        }),
        ">+" => Some(Header {
            style: Style::Folded,
            chomp: Chomp::Keep,
        }),
        _ => None,
    }
}

/// Consumes the continuation lines of a block scalar starting at
/// `lines[start]`: blank lines, and non-blank lines indented past column 0.
/// Returns the folded value and the index of the first line NOT consumed.
pub(crate) fn read_block(lines: &[&str], start: usize, header: &Header) -> (String, usize) {
    let mut end = start;
    while end < lines.len() && (lines[end].trim().is_empty() || leading_spaces(lines[end]) > 0) {
        end += 1;
    }

    let consumed = &lines[start..end];
    let indent = consumed
        .iter()
        .find(|line| !line.trim().is_empty())
        .map(|line| leading_spaces(line))
        .unwrap_or(0);
    let stripped: Vec<String> = consumed
        .iter()
        .map(|line| strip_indent(line, indent))
        .collect();

    (fold(&stripped, header), end)
}

fn leading_spaces(line: &str) -> usize {
    line.chars().take_while(|c| *c == ' ').count()
}

fn strip_indent(line: &str, indent: usize) -> String {
    if line.trim().is_empty() {
        return String::new();
    }
    // Cut within this line's own spaces, not `indent`: an under-indented
    // continuation must never be sliced mid-char or lose text.
    let cut = leading_spaces(line).min(indent);
    line[cut..].to_string()
}

fn fold(lines: &[String], header: &Header) -> String {
    let trailing_blanks = lines
        .iter()
        .rev()
        .take_while(|line| line.is_empty())
        .count();
    let content = &lines[..lines.len() - trailing_blanks];
    let body = match header.style {
        Style::Literal => content.join("\n"),
        Style::Folded => fold_paragraphs(content),
    };
    match header.chomp {
        Chomp::Strip => body,
        Chomp::Keep if trailing_blanks > 0 => format!("{body}\n"),
        Chomp::Keep => body,
    }
}

/// Folded style: lines within a paragraph join on a single space, paragraphs
/// (separated by blank lines) join on `\n`.
fn fold_paragraphs(lines: &[String]) -> String {
    let mut paragraphs: Vec<String> = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    for line in lines {
        if line.is_empty() {
            if !current.is_empty() {
                paragraphs.push(current.join(" "));
                current.clear();
            }
        } else {
            current.push(line.as_str());
        }
    }
    if !current.is_empty() {
        paragraphs.push(current.join(" "));
    }
    paragraphs.join("\n")
}

#[cfg(test)]
#[path = "block_scalar_tests.rs"]
mod tests;
