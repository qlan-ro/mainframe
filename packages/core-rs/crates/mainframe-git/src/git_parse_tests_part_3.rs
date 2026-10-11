#[test]
fn parse_status_z_empty() {
    assert_eq!(
        parse_status_z(""),
        PorcelainStatus {
            conflicted: vec![],
            files: vec![]
        }
    );
}

#[test]
fn parse_status_z_plain_modified() {
    assert_eq!(
        parse_status_z(" M src/foo.ts\0"),
        PorcelainStatus {
            conflicted: vec![],
            files: vec![status_file("src/foo.ts", " ", "M")],
        }
    );
}

#[test]
fn parse_status_z_rename_consumes_source_token() {
    assert_eq!(
        parse_status_z("R  renamed.txt\0a.txt\0"),
        PorcelainStatus {
            conflicted: vec![],
            files: vec![status_file("renamed.txt", "R", " ")],
        }
    );
}

#[test]
fn parse_status_z_uu_conflict() {
    assert_eq!(
        parse_status_z("UU f.txt\0"),
        PorcelainStatus {
            conflicted: vec!["f.txt".to_string()],
            files: vec![status_file("f.txt", "U", "U")],
        }
    );
}

#[test]
fn parse_status_z_rename_and_conflict_together() {
    assert_eq!(
        parse_status_z("R  renamed.txt\0a.txt\0UU f.txt\0"),
        PorcelainStatus {
            conflicted: vec!["f.txt".to_string()],
            files: vec![
                status_file("renamed.txt", "R", " "),
                status_file("f.txt", "U", "U"),
            ],
        }
    );
}

#[test]
fn parse_status_z_skips_ignored() {
    assert_eq!(
        parse_status_z("!! build/\0 M kept.ts\0"),
        PorcelainStatus {
            conflicted: vec![],
            files: vec![status_file("kept.ts", " ", "M")],
        }
    );
}
