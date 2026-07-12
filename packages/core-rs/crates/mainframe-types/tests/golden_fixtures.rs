//! Golden round-trip harness over every captured fixture in
//! `docs/rust-port/fixtures/` (Phase 0 artifacts).
//!
//! For each `event.*.json` the payload is deserialized into [`DaemonEvent`],
//! re-serialized, and compared for JSON-*semantic* equality with the original
//! (after stripping the fixture-only `_provenance`/`_route` keys). The
//! `{minimal, full}` wrapper is unfolded so both optional-field variants are
//! exercised. For each `route.*.json` the body is round-tripped through the
//! matching `mainframe-types` response type where one exists, else through
//! `serde_json::Value` (see the TODO(port) below for which routes are deferred).
//!
//! Failures are collected across *all* fixtures and reported together with the
//! offending filename (and payload variant) so a single drifting fixture is
//! immediately identifiable — a drift never hides behind an earlier one.
//!
//! Semantic equality canonicalizes every JSON number to `f64` before comparing,
//! so a fixture's integer literal `0` for an `f64` field (e.g. `Chat.totalCost`)
//! matches Rust's serialized `0.0`. All fixture numbers are < 2^53, so this is
//! lossless. This mirrors the byte-vs-semantic WIRE NOTE in `chat.rs`; true
//! byte-parity against the live Node serializer is a later differential-harness
//! concern, out of scope for these type round-trips.

// Test crate: unwrap/expect on setup (file IO, JSON parse) is how a broken
// fixture surfaces as a loud test failure. Matches the per-crate `lib.rs`
// exemption for the workspace-level deny of these lints.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use mainframe_types::adapter::AdapterInfo;
use mainframe_types::api::{ApiResponse, ApiResponseEmpty};
use mainframe_types::chat::{Chat, ChatMessage, Project};
use mainframe_types::events::DaemonEvent;

fn fixtures_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR = <repo>/packages/core-rs/crates/mainframe-types
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../docs/rust-port/fixtures")
        .canonicalize()
        .expect("fixtures directory must exist")
}

/// Strip the fixture-only metadata keys that are never on the wire.
fn strip_meta(mut v: Value) -> Value {
    if let Some(obj) = v.as_object_mut() {
        obj.remove("_provenance");
        obj.remove("_route");
    }
    v
}

/// Canonicalize every JSON number to `f64` so an integer literal compares equal
/// to a whole-valued float (see module docs).
fn norm(v: &Value) -> Value {
    match v {
        Value::Number(n) => n.as_f64().map(|f| json!(f)).unwrap_or_else(|| v.clone()),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, val)| (k.clone(), norm(val))).collect())
        }
        _ => v.clone(),
    }
}

/// Deserialize into `T`, re-serialize, and assert semantic equality. Returns a
/// human-readable reason on any failure instead of panicking, so the caller can
/// aggregate across fixtures.
fn roundtrip_as<T>(v: &Value) -> Result<(), String>
where
    T: DeserializeOwned + Serialize,
{
    let parsed: T =
        serde_json::from_value(v.clone()).map_err(|e| format!("deserialize failed: {e}"))?;
    let back = serde_json::to_value(&parsed).map_err(|e| format!("serialize failed: {e}"))?;
    if norm(v) != norm(&back) {
        return Err(format!(
            "round-trip mismatch:\n    in:  {v}\n    out: {back}"
        ));
    }
    Ok(())
}

/// Unfold a fixture root into the concrete event payload(s): the `{minimal,
/// full}` wrapper yields both, a flat event yields itself. `_provenance`/`_route`
/// are already stripped by the caller.
fn event_payloads(root: &Value) -> Vec<(String, Value)> {
    let obj = match root.as_object() {
        Some(o) => o,
        None => return vec![(String::new(), root.clone())],
    };
    if obj.contains_key("minimal") || obj.contains_key("full") {
        let mut out = Vec::new();
        for key in ["minimal", "full"] {
            if let Some(payload) = obj.get(key) {
                out.push((format!("[{key}]"), payload.clone()));
            }
        }
        out
    } else {
        vec![(String::new(), root.clone())]
    }
}

/// List fixture files with the given `event.`/`route.` prefix.
fn fixtures_with_prefix(prefix: &str) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(fixtures_dir())
        .expect("read fixtures dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(prefix) && n.ends_with(".json"))
        })
        .collect();
    files.sort();
    files
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string()
}

fn read_fixture(path: &Path) -> Value {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("read {path:?}: {e}"))
        .unwrap();
    serde_json::from_str(&raw)
        .map_err(|e| format!("parse {path:?}: {e}"))
        .unwrap()
}

/// Synthetic fixtures whose payload contradicts the frozen TS wire contract, so
/// the (correct) Rust type deliberately *rejects* them. For each entry the event
/// test asserts deserialization fails — proving the type enforces the contract —
/// and will break loudly if the fixture is corrected (move it out of this list)
/// or the type is later loosened to accept the bad value.
///
/// TODO(port): `event.plugin-panel-registered.json` uses `"zone": "sidebar"`,
/// which is not a valid `UIZone` (`ZoneId | 'fullview'`, see
/// `packages/types/src/plugin.ts`). The Phase-0 fixture owner should replace it
/// with a real zone (e.g. `"right-bottom"`); this harness cannot edit fixtures.
const KNOWN_CONTRACT_VIOLATIONS: &[(&str, &str)] = &[(
    "event.plugin-panel-registered.json",
    "zone \"sidebar\" is not a valid UIZone (ZoneId | 'fullview')",
)];

fn known_violation(name: &str) -> Option<&'static str> {
    KNOWN_CONTRACT_VIOLATIONS
        .iter()
        .find(|(f, _)| *f == name)
        .map(|(_, reason)| *reason)
}

#[test]
fn every_event_fixture_round_trips() {
    let files = fixtures_with_prefix("event.");
    assert!(!files.is_empty(), "no event.*.json fixtures found");

    let mut failures: Vec<String> = Vec::new();
    let mut checked = 0usize;

    for path in &files {
        let name = file_name(path);
        let root = strip_meta(read_fixture(path));
        let violation = known_violation(&name);
        for (variant, payload) in event_payloads(&root) {
            checked += 1;
            match (violation, roundtrip_as::<DaemonEvent>(&payload)) {
                // Contract-conforming fixture: must round-trip.
                (None, Ok(())) => {}
                (None, Err(reason)) => failures.push(format!("{name}{variant}: {reason}")),
                // Known-bad fixture: the type must reject it. If it now parses,
                // the fixture was fixed (or the type loosened) — re-review.
                (Some(_), Err(_)) => {}
                (Some(reason), Ok(())) => failures.push(format!(
                    "{name}{variant}: expected rejection ({reason}) but it round-tripped — \
                     remove it from KNOWN_CONTRACT_VIOLATIONS"
                )),
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} event fixture(s) drifted (of {checked} checked):\n\n{}",
        failures.len(),
        failures.join("\n\n")
    );
}

#[test]
fn every_route_fixture_round_trips() {
    let files = fixtures_with_prefix("route.");
    assert!(!files.is_empty(), "no route.*.json fixtures found");

    let mut failures: Vec<String> = Vec::new();

    for path in &files {
        let name = file_name(path);
        let body = strip_meta(read_fixture(path));

        // Route each fixture through its matching `mainframe-types` response
        // type. TODO(port): `route.health.json` (GET /health) has no dedicated
        // type in `mainframe-types` yet — the health/status envelope is defined
        // in `mainframe-server` and gets its own type when that crate is ported;
        // until then it round-trips through `serde_json::Value` (identity). Every
        // other route below is backed by a real type, so these assertions do
        // catch type drift.
        let result = match name.as_str() {
            "route.adapters-list.json" => roundtrip_as::<ApiResponse<Vec<AdapterInfo>>>(&body),
            "route.chat-create.json" => roundtrip_as::<ApiResponse<Chat>>(&body),
            "route.chat-get.json" => roundtrip_as::<ApiResponse<Chat>>(&body),
            "route.chat-messages.json" => roundtrip_as::<ApiResponse<Vec<ChatMessage>>>(&body),
            "route.chats-list.json" => roundtrip_as::<ApiResponse<Vec<Chat>>>(&body),
            "route.projects-list.json" => roundtrip_as::<ApiResponse<Vec<Project>>>(&body),
            "route.tags-list.json" => roundtrip_as::<ApiResponse<Vec<String>>>(&body),
            "route.mutation-ok-empty.json" => roundtrip_as::<ApiResponseEmpty>(&body),
            "route.error.json" => roundtrip_as::<ApiResponse<Value>>(&body),
            _ => roundtrip_as::<Value>(&body),
        };
        if let Err(reason) = result {
            failures.push(format!("{name}: {reason}"));
        }
    }

    assert!(
        failures.is_empty(),
        "{} route fixture(s) drifted:\n\n{}",
        failures.len(),
        failures.join("\n\n")
    );
}

/// Guard against a fixture being silently added and never round-tripped: every
/// `.json` in the directory must be either an `event.*` or a `route.*` fixture.
#[test]
fn all_fixtures_are_event_or_route() {
    let all: Vec<PathBuf> = std::fs::read_dir(fixtures_dir())
        .expect("read fixtures dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("json"))
        .collect();

    let events = fixtures_with_prefix("event.").len();
    let routes = fixtures_with_prefix("route.").len();

    assert_eq!(
        all.len(),
        events + routes,
        "some .json fixture is neither event.* nor route.*: {:?}",
        all.iter().map(|p| file_name(p)).collect::<Vec<_>>()
    );
}
