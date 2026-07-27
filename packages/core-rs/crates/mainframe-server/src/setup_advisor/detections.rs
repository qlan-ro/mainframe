//! The fingerprint's detection vectors, named as data.
//!
//! Every table in this feature — the chips in `signals.rs`, the rules in
//! `rules/` — selects one vector per row. Naming the vector keeps those tables
//! data; without it each row needs its own closure just to say which `Vec` to
//! look in.

use mainframe_types::setup_advisor::ProjectFingerprint;

/// Which fingerprint vector a detection key is looked up in.
#[derive(Debug, Clone, Copy)]
pub enum Field {
    Language,
    Framework,
    Database,
    ExternalApi,
    Testing,
    Tooling,
    Dir,
}

pub fn values(fp: &ProjectFingerprint, field: Field) -> &[String] {
    match field {
        Field::Language => &fp.languages,
        Field::Framework => &fp.frameworks,
        Field::Database => &fp.databases,
        Field::ExternalApi => &fp.external_apis,
        Field::Testing => &fp.testing,
        Field::Tooling => &fp.tooling,
        Field::Dir => &fp.dirs,
    }
}

/// Whether a detection vector carries a canonical label.
pub fn has(values: &[String], label: &str) -> bool {
    values.iter().any(|value| value == label)
}

/// Appends `label` unless the vector already carries it. The same detection
/// arrives from more than one manifest — `jest` from both a dependency and a
/// config file — and a repeat would surface as a duplicate chip.
pub fn push_unique(target: &mut Vec<String>, label: &str) {
    if !has(target, label) {
        target.push(label.to_string());
    }
}
