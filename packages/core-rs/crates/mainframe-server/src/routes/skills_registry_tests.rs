use super::*;
use crate::skills_cli::{CatalogEntry, SearchEntry};

#[test]
fn an_unavailable_catalog_serializes_as_a_status_not_an_empty_list() {
    let json = catalog_json(CatalogOutcome::Unavailable);

    assert_eq!(json["status"], "unavailable");
    assert!(
        json["entries"].is_null(),
        "an empty list would read as 'the registry has no skills'"
    );
}

#[test]
fn a_catalog_entry_carries_its_sparkline_and_official_flag() {
    let outcome = CatalogOutcome::Available {
        entries: vec![CatalogEntry {
            source: "vercel-labs/skills".to_string(),
            skill_id: "find-skills".to_string(),
            name: "find-skills".to_string(),
            installs: 2_787_493,
            weekly_installs: Some(vec![1, 2, 3]),
            is_official: true,
        }],
    };

    let json = catalog_json(outcome);

    let entry = &json["entries"][0];
    assert_eq!(entry["skillId"], "find-skills");
    assert_eq!(entry["installs"], 2_787_493);
    assert_eq!(entry["weeklyInstalls"], json!([1, 2, 3]));
    assert_eq!(entry["isOfficial"], true);
}

// Wire contract: `packages/types/src/skills-cli.ts` decodes `isOfficial` with
// `.nullish()`. Search results carry an explicit `null` for the flag the
// search API doesn't report, so the UI can withhold the official marker
// instead of asserting a skill isn't official.
#[test]
fn a_search_row_serializes_an_unknown_official_flag_as_null() {
    let json = search_json(vec![SearchEntry {
        source: "microsoft/playwright-cli".to_string(),
        skill_id: "playwright-cli".to_string(),
        name: "playwright-cli".to_string(),
        installs: 106_797,
        is_official: None,
    }]);

    assert!(json[0]["isOfficial"].is_null());
    assert_eq!(json[0]["source"], "microsoft/playwright-cli");
}
