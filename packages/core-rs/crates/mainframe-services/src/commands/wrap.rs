//! Ported from `src/commands/wrap.ts`.

use rand::Rng;

pub fn wrap_mainframe_command(name: &str, _content: &str, args: Option<&str>) -> String {
    let id = format!("cmd_{}", random_hex8());
    let template = args.unwrap_or("");
    [
        format!("<mainframe-command name=\"{name}\" id=\"{id}\">"),
        template.to_string(),
        String::new(),
        "Wrap your entire response in:".to_string(),
        format!("<mainframe-command-response id=\"{id}\">"),
        "YOUR RESPONSE HERE".to_string(),
        "</mainframe-command-response>".to_string(),
        "</mainframe-command>".to_string(),
    ]
    .join("\n")
}

/// `randomUUID().slice(0, 8)` — the first 8 characters of a v4 UUID are hex
/// digits; reproduced with 8 random hex chars (the id is not a wire contract).
fn random_hex8() -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut rng = rand::thread_rng();
    (0..8).map(|_| HEX[rng.gen_range(0..16)] as char).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_with_matching_open_and_response_ids() {
        let out = wrap_mainframe_command("review", "ignored", Some("do the thing"));
        assert!(out.starts_with("<mainframe-command name=\"review\" id=\"cmd_"));
        assert!(out.contains("\ndo the thing\n\nWrap your entire response in:\n"));
        assert!(out.ends_with("</mainframe-command-response>\n</mainframe-command>"));
        // Same id in the open tag and the response tag.
        let id = out
            .split("id=\"")
            .nth(1)
            .and_then(|s| s.split('"').next())
            .unwrap();
        assert_eq!(id.len(), "cmd_".len() + 8);
        assert_eq!(out.matches(id).count(), 2);
    }

    #[test]
    fn empty_template_when_no_args() {
        let out = wrap_mainframe_command("gen", "", None);
        // The template line is empty → two consecutive newlines after the open tag.
        assert!(out.contains("\">\n\n\nWrap your entire response in:"));
    }
}

// PORT STATUS: src/commands/wrap.ts (16 lines)
// confidence: high
// todos: 0
// notes: joins the same 8 lines with '\n'. `_content` is unused (as in the TS).
// randomUUID().slice(0,8) → 8 random hex chars via `rand` (the id is random and
// not asserted on the wire). No TS test existed; added structural coverage.
