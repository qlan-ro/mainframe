use super::*;

#[test]
fn parse_header_accepts_the_six_forms() {
    assert_eq!(
        parse_header("|"),
        Some(Header {
            style: Style::Literal,
            chomp: Chomp::Strip
        })
    );
    assert_eq!(
        parse_header("|-"),
        Some(Header {
            style: Style::Literal,
            chomp: Chomp::Strip
        })
    );
    assert_eq!(
        parse_header("|+"),
        Some(Header {
            style: Style::Literal,
            chomp: Chomp::Keep
        })
    );
    assert_eq!(
        parse_header(">"),
        Some(Header {
            style: Style::Folded,
            chomp: Chomp::Strip
        })
    );
    assert_eq!(
        parse_header(">-"),
        Some(Header {
            style: Style::Folded,
            chomp: Chomp::Strip
        })
    );
    assert_eq!(
        parse_header(">+"),
        Some(Header {
            style: Style::Folded,
            chomp: Chomp::Keep
        })
    );
}

#[test]
fn parse_header_rejects_unsupported_forms() {
    assert_eq!(parse_header("|2"), None);
    assert_eq!(parse_header(">4"), None);
    assert_eq!(parse_header("Work with PDFs"), None);
}

#[test]
fn read_block_strips_a_mixed_indentation_block() {
    let lines = ["  outer", "    nested", "  outer2", "next"];
    let header = Header {
        style: Style::Literal,
        chomp: Chomp::Strip,
    };
    let (value, end) = read_block(&lines, 0, &header);
    assert_eq!(value, "outer\n  nested\nouter2");
    assert_eq!(end, 3);
}

#[test]
fn read_block_handles_under_indented_multibyte_continuation() {
    // Byte 4 falls inside '✅' — the old indent-anchored slice panicked here.
    let lines = ["    outer", "  ✅ done", "next"];
    let header = Header {
        style: Style::Literal,
        chomp: Chomp::Strip,
    };
    let (value, end) = read_block(&lines, 0, &header);
    assert_eq!(value, "outer\n✅ done");
    assert_eq!(end, 2);
}
