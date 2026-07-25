//! The `skills` rules dataset.
//!
//! Structure follows the upstream `claude-code-setup v1.0.0` bundle's
//! `claude-automation-recommender` skill; every `command`, source repo, install
//! count, and skill id is transcribed from
//! `docs/research/2026-07-25-todo-191-command-provenance.md`, which is the only
//! source of truth for this file. A signal with no row there ships no rule —
//! `passport` is the one such signal.
//!
//! Priority runs in tier order so a registry-backed skill always outranks a
//! scaffold: vendor-official 10–26, third-party 40–58, first-party 80–87.
//!
//! The submodules exist only to stay under the 300-line file limit; `RULES` is
//! still one flat static slice, and the `const` items inline into it without a
//! `LazyLock`.

mod aggregator_languages;
mod aggregator_tooling;
mod common;
mod scaffold;
mod scaffold_bodies;
mod vendor_services;
mod vendor_stack;

use crate::setup_advisor::rule::Rule;

pub static RULES: &[Rule] = &[
    vendor_stack::REACT,
    vendor_stack::VUE,
    vendor_stack::SVELTE,
    vendor_stack::FASTAPI,
    vendor_stack::SUPABASE,
    vendor_stack::POSTGRES,
    vendor_stack::PRISMA,
    vendor_stack::CONVEX,
    vendor_stack::VITEST,
    vendor_stack::PLAYWRIGHT,
    vendor_services::STRIPE,
    vendor_services::CLERK,
    vendor_services::AUTH0,
    vendor_services::LANGCHAIN,
    vendor_services::OPENAI,
    vendor_services::AWS,
    vendor_services::SENTRY,
    aggregator_languages::TYPESCRIPT,
    aggregator_languages::PYTHON,
    aggregator_languages::RUST,
    aggregator_languages::GOLANG,
    aggregator_languages::JAVA,
    aggregator_languages::NEXTJS,
    aggregator_languages::ANGULAR,
    aggregator_languages::EXPRESS,
    aggregator_languages::DJANGO,
    aggregator_tooling::DRIZZLE,
    aggregator_tooling::JEST,
    aggregator_tooling::PYTEST,
    aggregator_tooling::TAILWIND,
    aggregator_tooling::DOCKER,
    aggregator_tooling::NEXT_AUTH,
    aggregator_tooling::RUFF,
    aggregator_tooling::ESLINT_PRETTIER,
    aggregator_tooling::TSCONFIG,
    scaffold::PROJECT_CONVENTIONS,
    scaffold::GEN_TEST,
    scaffold::NEW_COMPONENT,
    scaffold::API_DOC,
    scaffold::CREATE_MIGRATION,
    scaffold::PR_CHECK,
    scaffold::RELEASE_NOTES,
    scaffold::SETUP_DEV,
];
