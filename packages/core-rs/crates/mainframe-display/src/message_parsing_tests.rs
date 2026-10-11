use super::*;

#[test]
fn strips_response_wrapper_tags() {
    let input =
        "<mainframe-command-response id=\"cmd_abc\">Hello world</mainframe-command-response>";
    assert_eq!(strip_mainframe_command_tags(input), "Hello world");
}

#[test]
fn returns_text_unchanged_when_no_tags_present() {
    assert_eq!(strip_mainframe_command_tags("Normal text"), "Normal text");
}

#[test]
fn strips_command_wrapper_from_user_messages() {
    let input = "<mainframe-command name=\"init\" id=\"cmd_abc\">Do init work</mainframe-command>";
    assert_eq!(strip_mainframe_command_tags(input), "");
}

#[test]
fn an_unclosed_command_wrapper_strips_to_end_of_input() {
    // The open tag is complete but the body never closed — a wrapper
    // still streaming.
    assert_eq!(
        strip_mainframe_command_tags("<mainframe-command name=\"review\">do it"),
        ""
    );
    // The open tag itself is incomplete — the first chunk of a real
    // stream, before `remove_mainframe_wrapper` can even find its `>`.
    assert_eq!(strip_mainframe_command_tags("<mainframe-command na"), "");
}

#[test]
fn parse_command_message_uses_args_over_body() {
    let input = "<command-name>/deploy</command-name><command-args>prod</command-args>rest";
    let parsed = parse_command_message(input).unwrap();
    assert_eq!(parsed.command_name, "deploy");
    assert_eq!(parsed.user_text, "prod");
}

#[test]
fn format_turn_duration_buckets() {
    assert_eq!(format_turn_duration(f64::NAN), "");
    assert_eq!(format_turn_duration(-5.0), "");
    assert_eq!(format_turn_duration(250.4), "250ms");
    assert_eq!(format_turn_duration(2500.0), "2.5s");
    assert_eq!(format_turn_duration(42_000.0), "42s");
}

#[test]
fn decode_xml_attr_unescapes() {
    assert_eq!(
        decode_xml_attr("a &amp; &lt;b&gt; &quot;c&quot;"),
        "a & <b> \"c\""
    );
}

#[test]
fn attached_file_path_extracts_names_and_strips_tags() {
    let text = "before <attached_file_path name=\"a &amp; b.txt\" /> after";
    let out = parse_attached_file_path_tags(text);
    assert_eq!(out.files.len(), 1);
    assert_eq!(out.files[0].name, "a & b.txt");
    assert_eq!(out.clean_text, "before  after");
}

#[test]
fn strips_image_coordinate_note() {
    let text = "keep [Image: original 100x200, displayed at 50x100. Multiply coordinates by 2.0 to map to original image.] tail";
    let out = parse_attached_file_path_tags(text);
    assert_eq!(out.clean_text, "keep  tail");
}
