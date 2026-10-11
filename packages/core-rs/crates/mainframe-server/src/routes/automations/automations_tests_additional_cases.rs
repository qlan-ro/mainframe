#[test]
fn output_preview_truncates_at_32k() {
    let mut outputs = serde_json::Map::new();
    outputs.insert("small".to_string(), json!("x"));
    assert_eq!(output_preview(Some(&outputs)).unwrap(), r#"{"small":"x"}"#);

    let mut big = serde_json::Map::new();
    big.insert("blob".to_string(), json!("y".repeat(40 * 1024)));
    let preview = output_preview(Some(&big)).unwrap();
    assert!(preview.starts_with("[truncated — "));
    assert!(preview.len() < 64);
    assert_eq!(output_preview(None), None);
}
