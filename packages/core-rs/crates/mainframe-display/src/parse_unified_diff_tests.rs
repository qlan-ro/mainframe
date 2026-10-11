use super::*;

#[test]
fn empty_or_whitespace_returns_no_hunks() {
    assert!(parse_unified_diff("").is_empty());
    assert!(parse_unified_diff("   \n  ").is_empty());
}

#[test]
fn headerless_diff_collapses_into_a_single_default_hunk() {
    let hunks = parse_unified_diff("+foo\n-bar");
    assert_eq!(hunks.len(), 1);
    assert_eq!(hunks[0].old_start, 1);
    assert_eq!(hunks[0].old_lines, 0);
    assert_eq!(hunks[0].new_start, 1);
    assert_eq!(hunks[0].new_lines, 0);
    assert_eq!(hunks[0].lines, vec!["+foo".to_string(), "-bar".to_string()]);
}

#[test]
fn single_header_with_counts() {
    let hunks = parse_unified_diff("@@ -1,3 +2,4 @@\n context\n+added");
    assert_eq!(hunks.len(), 1);
    assert_eq!(hunks[0].old_start, 1);
    assert_eq!(hunks[0].old_lines, 3);
    assert_eq!(hunks[0].new_start, 2);
    assert_eq!(hunks[0].new_lines, 4);
    assert_eq!(
        hunks[0].lines,
        vec![" context".to_string(), "+added".to_string()]
    );
}

#[test]
fn header_without_comma_counts_defaults_to_one() {
    let hunks = parse_unified_diff("@@ -5 +6 @@\n-x");
    assert_eq!(hunks.len(), 1);
    assert_eq!(hunks[0].old_start, 5);
    assert_eq!(hunks[0].old_lines, 1);
    assert_eq!(hunks[0].new_start, 6);
    assert_eq!(hunks[0].new_lines, 1);
    assert_eq!(hunks[0].lines, vec!["-x".to_string()]);
}

#[test]
fn trailing_section_text_after_header_is_ignored() {
    let hunks = parse_unified_diff("@@ -1,1 +1,1 @@ fn foo() {\n-a\n+b");
    assert_eq!(hunks.len(), 1);
    assert_eq!(hunks[0].old_start, 1);
    assert_eq!(hunks[0].lines, vec!["-a".to_string(), "+b".to_string()]);
}

#[test]
fn multiple_headers_produce_multiple_hunks() {
    let hunks = parse_unified_diff("@@ -1,1 +1,1 @@\n-a\n@@ -10,2 +10,3 @@\n+b\n+c");
    assert_eq!(hunks.len(), 2);
    assert_eq!(hunks[0].old_start, 1);
    assert_eq!(hunks[0].lines, vec!["-a".to_string()]);
    assert_eq!(hunks[1].old_start, 10);
    assert_eq!(hunks[1].old_lines, 2);
    assert_eq!(hunks[1].new_lines, 3);
    assert_eq!(hunks[1].lines, vec!["+b".to_string(), "+c".to_string()]);
}
