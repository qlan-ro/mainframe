//! The skills.sh registry surface: catalog extraction from the homepage
//! payload, and the search proxy.
//!
//! The catalog parser reads someone else's Next.js flight payload, so its
//! contract is a checked-in fixture (`fixtures/skills-sh-home.html`, trimmed
//! from a real response on 2026-08-03) rather than anything the registry
//! promises. When it breaks, these tests are how you'll know it broke here and
//! not in the UI.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Mutex;

use mainframe_server::skills_cli::catalog::{self, RegistryFetcher};
use mainframe_server::skills_cli::{BoxFuture, CatalogOutcome};

const HOME_FIXTURE: &str = include_str!("fixtures/skills-sh-home.html");

/// Replies with one canned body (or failure) and counts the calls.
struct StubFetcher {
    reply: Result<String, String>,
    calls: Mutex<usize>,
}

impl StubFetcher {
    fn ok(body: &str) -> Self {
        Self {
            reply: Ok(body.to_string()),
            calls: Mutex::new(0),
        }
    }

    fn failing() -> Self {
        Self {
            reply: Err("connection refused".to_string()),
            calls: Mutex::new(0),
        }
    }

    fn calls(&self) -> usize {
        *self.calls.lock().unwrap()
    }
}

impl RegistryFetcher for StubFetcher {
    fn get(&self, _url: String) -> BoxFuture<'_, Result<String, String>> {
        *self.calls.lock().unwrap() += 1;
        let reply = self.reply.clone();
        Box::pin(async move { reply })
    }
}

#[test]
fn the_homepage_fixture_parses_into_typed_ranked_entries() {
    let entries = mainframe_server::skills_cli::catalog_parse::extract_initial_skills(HOME_FIXTURE)
        .expect("the fixture carries a catalog");

    assert_eq!(entries.len(), 3);
    let first = &entries[0];
    assert_eq!(first.source, "vercel-labs/skills");
    assert_eq!(first.skill_id, "find-skills");
    assert_eq!(first.name, "find-skills");
    assert_eq!(first.installs, 2_787_493);
    assert_eq!(
        first.weekly_installs,
        Some(vec![
            118887, 110834, 113781, 109199, 109085, 115475, 107969, 101120
        ])
    );
    assert!(first.is_official);
    // Ranked by installs descending, which is the order Browse relies on.
    assert!(entries[0].installs > entries[1].installs);
    assert!(entries[1].installs > entries[2].installs);
}

/// `isOfficial` is omitted for the majority of entries rather than serialized
/// as `false`; a required field here would drop 74% of the catalog.
#[test]
fn an_entry_without_is_official_parses_as_not_official() {
    let entries =
        mainframe_server::skills_cli::catalog_parse::extract_initial_skills(HOME_FIXTURE).unwrap();

    let grill_me = entries
        .iter()
        .find(|e| e.skill_id == "grill-me")
        .expect("grill-me entry present");
    assert!(!grill_me.is_official);
}

#[tokio::test]
async fn a_page_without_the_payload_is_unavailable_not_an_empty_catalog() {
    let fetcher = StubFetcher::ok("<html><body>the page was redesigned</body></html>");

    let outcome = catalog::load(&fetcher).await;

    assert!(
        matches!(outcome, CatalogOutcome::Unavailable),
        "{outcome:?}"
    );
}

#[tokio::test]
async fn a_failed_fetch_is_unavailable_and_is_not_cached() {
    let fetcher = StubFetcher::failing();

    let first = catalog::load(&fetcher).await;
    let second = catalog::load(&fetcher).await;

    assert!(matches!(first, CatalogOutcome::Unavailable), "{first:?}");
    assert!(matches!(second, CatalogOutcome::Unavailable), "{second:?}");
    assert_eq!(
        fetcher.calls(),
        2,
        "a failure must not poison the cache for the next 6 hours"
    );
}

#[tokio::test]
async fn search_maps_the_registry_response_onto_the_wire_shape() {
    let body = r#"{"query":"playwright","searchType":"fuzzy","skills":[
        {"id":"microsoft/playwright-cli/playwright-cli","skillId":"playwright-cli","name":"playwright-cli","installs":106797,"source":"microsoft/playwright-cli"}
    ],"count":1,"duration_ms":402}"#;
    let fetcher = StubFetcher::ok(body);

    let results = catalog::search(&fetcher, "playwright").await.unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].source, "microsoft/playwright-cli");
    assert_eq!(results[0].skill_id, "playwright-cli");
    assert_eq!(results[0].installs, 106_797);
    assert_eq!(
        results[0].is_official, None,
        "the search API reports no official flag; unknown must not read as false"
    );
}

#[tokio::test]
async fn search_surfaces_an_unparsable_response_as_an_error() {
    let fetcher = StubFetcher::ok("<html>gateway timeout</html>");

    let result = catalog::search(&fetcher, "playwright").await;

    assert!(result.is_err(), "{result:?}");
}
