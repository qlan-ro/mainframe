/// Wrap a Mainframe command's prompt so the agent answers inside a
/// `<mainframe-command-response>` tag carrying the same random id.
pub fn wrap_mainframe_command(name: &str, args: Option<&str>) -> String {
    let id = format!("cmd_{:08x}", rand::random::<u32>());
    let template = args.unwrap_or("");
    format!(
        "<mainframe-command name=\"{name}\" id=\"{id}\">\n\
         {template}\n\
         \n\
         Wrap your entire response in:\n\
         <mainframe-command-response id=\"{id}\">\n\
         YOUR RESPONSE HERE\n\
         </mainframe-command-response>\n\
         </mainframe-command>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_with_matching_open_and_response_ids() {
        let out = wrap_mainframe_command("review", Some("do the thing"));
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
        let out = wrap_mainframe_command("gen", None);
        // The template line is empty → two consecutive newlines after the open tag.
        assert!(out.contains("\">\n\n\nWrap your entire response in:"));
    }
}
