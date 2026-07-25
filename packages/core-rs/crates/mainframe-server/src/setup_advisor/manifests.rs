//! Root-manifest parsing and the dependency-name to bucket mapping.
//!
//! Detections are recorded as canonical labels (`aws`, `postgres`), never raw
//! dependency names — the rules dataset predicates on the canonical form.

use std::path::Path;

use mainframe_types::setup_advisor::ProjectFingerprint;

use crate::path_utils::is_within_base;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Bucket {
    Language,
    Framework,
    Database,
    ExternalApi,
    Testing,
}

/// Exact dependency name to (bucket, canonical label).
const EXACT: &[(&str, Bucket, &str)] = &[
    ("react", Bucket::Framework, "react"),
    ("next", Bucket::Framework, "nextjs"),
    ("vue", Bucket::Framework, "vue"),
    ("@angular/core", Bucket::Framework, "angular"),
    ("svelte", Bucket::Framework, "svelte"),
    ("express", Bucket::Framework, "express"),
    ("fastapi", Bucket::Framework, "fastapi"),
    ("django", Bucket::Framework, "django"),
    ("vitest", Bucket::Testing, "vitest"),
    ("jest", Bucket::Testing, "jest"),
    ("@playwright/test", Bucket::Testing, "playwright"),
    ("playwright", Bucket::Testing, "playwright"),
    ("pytest", Bucket::Testing, "pytest"),
    ("prisma", Bucket::Database, "prisma"),
    ("@prisma/client", Bucket::Database, "prisma"),
    ("drizzle-orm", Bucket::Database, "drizzle"),
    ("convex", Bucket::Database, "convex"),
    ("pg", Bucket::Database, "postgres"),
    ("postgres", Bucket::Database, "postgres"),
    ("stripe", Bucket::ExternalApi, "stripe"),
    ("openai", Bucket::ExternalApi, "openai"),
    ("langchain", Bucket::ExternalApi, "langchain"),
    ("next-auth", Bucket::ExternalApi, "next-auth"),
    ("passport", Bucket::ExternalApi, "passport"),
];

/// Scoped families whose member packages all map to one label.
const SCOPES: &[(&str, Bucket, &str)] = &[
    ("@supabase/", Bucket::Database, "supabase"),
    ("@aws-sdk/", Bucket::ExternalApi, "aws"),
    ("@sentry/", Bucket::ExternalApi, "sentry"),
    ("@clerk/", Bucket::ExternalApi, "clerk"),
    ("@auth0/", Bucket::ExternalApi, "auth0"),
    ("@anthropic-ai/", Bucket::ExternalApi, "anthropic"),
];

/// Manifests whose mere presence identifies a language.
const BARE_LANGUAGE_MANIFESTS: &[(&str, &str)] = &[
    ("Cargo.toml", "rust"),
    ("go.mod", "go"),
    ("pom.xml", "java"),
];

/// Reads `name` from `real_root`, refusing to follow a symlink out of the project.
///
/// A bare `read_to_string(root.join(name))` follows the link and silently reads an
/// arbitrary file; a cloned repo can ship such a link. Canonicalizing before the
/// read is what makes the containment check meaningful.
async fn read_contained_root_file(real_root: &Path, name: &str) -> Option<String> {
    let real = tokio::fs::canonicalize(real_root.join(name)).await.ok()?;
    if !is_within_base(real_root, &real) {
        tracing::warn!(
            file = name,
            "setup advisor: root manifest resolves outside the project; skipping"
        );
        return None;
    }
    tokio::fs::read_to_string(&real).await.ok()
}

fn push_unique(target: &mut Vec<String>, label: &str) {
    if !target.iter().any(|existing| existing == label) {
        target.push(label.to_string());
    }
}

fn record(fp: &mut ProjectFingerprint, bucket: Bucket, label: &str) {
    let target = match bucket {
        Bucket::Language => &mut fp.languages,
        Bucket::Framework => &mut fp.frameworks,
        Bucket::Database => &mut fp.databases,
        Bucket::ExternalApi => &mut fp.external_apis,
        Bucket::Testing => &mut fp.testing,
    };
    push_unique(target, label);
}

/// Maps one dependency name onto the fingerprint, if it is one we know.
fn classify(fp: &mut ProjectFingerprint, dependency: &str) {
    if let Some(&(_, bucket, label)) = EXACT.iter().find(|(name, _, _)| *name == dependency) {
        record(fp, bucket, label);
        return;
    }
    if let Some(&(_, bucket, label)) = SCOPES
        .iter()
        .find(|(prefix, _, _)| dependency.starts_with(prefix))
    {
        record(fp, bucket, label);
    }
}

/// Strips a PEP 508 requirement down to its bare distribution name
/// (`fastapi>=0.1` and `fastapi[all]` both yield `fastapi`).
fn requirement_name(requirement: &str) -> &str {
    let end = requirement
        .find(|c: char| c.is_whitespace() || "<>=!~[;(,".contains(c))
        .unwrap_or(requirement.len());
    requirement[..end].trim()
}

async fn detect_package_json(real_root: &Path, fp: &mut ProjectFingerprint) {
    let Some(raw) = read_contained_root_file(real_root, "package.json").await else {
        return;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
        tracing::warn!("setup advisor: package.json is not valid JSON; skipping it");
        return;
    };
    record(fp, Bucket::Language, "typescript");
    for section in ["dependencies", "devDependencies"] {
        let Some(entries) = parsed.get(section).and_then(|v| v.as_object()) else {
            continue;
        };
        for name in entries.keys() {
            classify(fp, name);
        }
    }
}

/// Collects dependency names from both pyproject layouts: PEP 621
/// (`[project].dependencies`, a list of requirement strings) and poetry
/// (`[tool.poetry...dependencies]`, tables keyed by name).
fn pyproject_dependencies(parsed: &toml::Value) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(project) = parsed.get("project") {
        let lists = std::iter::once(project.get("dependencies")).chain(
            project
                .get("optional-dependencies")
                .and_then(|v| v.as_table())
                .into_iter()
                .flat_map(|t| t.values().map(Some)),
        );
        for list in lists.flatten().filter_map(|v| v.as_array()) {
            names.extend(
                list.iter()
                    .filter_map(|v| v.as_str())
                    .map(|r| requirement_name(r).to_string()),
            );
        }
    }
    if let Some(poetry) = parsed.get("tool").and_then(|t| t.get("poetry")) {
        let groups = poetry
            .get("group")
            .and_then(|g| g.as_table())
            .into_iter()
            .flat_map(|t| t.values().filter_map(|g| g.get("dependencies")));
        for table in std::iter::once(poetry.get("dependencies"))
            .flatten()
            .chain(groups)
            .filter_map(|v| v.as_table())
        {
            names.extend(table.keys().cloned());
        }
    }
    names
}

async fn detect_pyproject(real_root: &Path, fp: &mut ProjectFingerprint) {
    let Some(raw) = read_contained_root_file(real_root, "pyproject.toml").await else {
        return;
    };
    let Ok(parsed) = raw.parse::<toml::Value>() else {
        tracing::warn!("setup advisor: pyproject.toml is not valid TOML; skipping it");
        return;
    };
    record(fp, Bucket::Language, "python");
    for name in pyproject_dependencies(&parsed) {
        classify(fp, &name);
    }
}

/// Fills the dependency-derived buckets of `fp` from the project's root manifests.
///
/// Root only, by design: a nested `package.json` describes a subpackage, not the
/// project. Parse failures are logged and contribute nothing — a broken manifest
/// degrades the report, it never fails the request.
pub async fn detect_root_manifests(real_root: &Path, fp: &mut ProjectFingerprint) {
    // The caller's root may itself be a symlink (macOS `/var` → `/private/var`),
    // which would make every containment check fail; compare canonical to canonical.
    let Ok(real_root) = tokio::fs::canonicalize(real_root).await else {
        return;
    };

    detect_package_json(&real_root, fp).await;
    detect_pyproject(&real_root, fp).await;

    for (name, language) in BARE_LANGUAGE_MANIFESTS {
        if read_contained_root_file(&real_root, name).await.is_some() {
            record(fp, Bucket::Language, language);
        }
    }
}

#[cfg(test)]
mod tests;
