//! The label families and root-config evidence more than one category fires on.
//!
//! Kept in one place because the categories must agree: `security-guidance` and
//! `security-reviewer` are the same recommendation in two forms, and a stripe
//! added to one list but not the other would ship a project half a security pass.

use crate::setup_advisor::detections::Field;
use crate::setup_advisor::rule::Evidence;

/// Dependencies whose presence means the project handles money or identity.
pub const SENSITIVE_APIS: &[&str] = &["stripe", "next-auth", "clerk", "auth0", "passport"];

pub const FRONTEND_FRAMEWORKS: &[&str] = &["react", "nextjs", "vue", "angular", "svelte"];

/// Frameworks that serve an HTTP API worth documenting.
pub const BACKEND_FRAMEWORKS: &[&str] = &["express", "fastapi", "django"];

pub const PRETTIER_CONFIG: Evidence = Evidence::Detected(
    Field::Tooling,
    "prettier",
    "a Prettier config at the repo root",
);
pub const ESLINT_CONFIG: Evidence = Evidence::Detected(
    Field::Tooling,
    "eslint",
    "an ESLint config at the repo root",
);
pub const RUFF_CONFIG: Evidence =
    Evidence::Detected(Field::Tooling, "ruff", "a ruff.toml at the repo root");
pub const TSCONFIG: Evidence = Evidence::Detected(
    Field::Tooling,
    "tsconfig",
    "a tsconfig.json at the repo root",
);

/// Any root config a generated hook could drive. `hookify` offers to write those
/// hooks, so it fires on exactly what the individual hook rules fire on.
pub const ANY_ROOT_TOOLING: Evidence =
    Evidence::Either(&[PRETTIER_CONFIG, ESLINT_CONFIG, RUFF_CONFIG, TSCONFIG]);
