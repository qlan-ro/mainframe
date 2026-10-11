use super::*;

#[test]
fn strip_tag_pairs_removes_image_block() {
    assert_eq!(
        clean_prompt("<image name=[Image #1]></image>Add a dark mode toggle to settings"),
        "Add a dark mode toggle to settings"
    );
}

#[test]
fn cwd_regex_extracts_first_value() {
    assert_eq!(
        cwd_regex(r#"{"payload":{"cwd":"/Users/dev/app","x":1}}"#).as_deref(),
        Some("/Users/dev/app")
    );
}
