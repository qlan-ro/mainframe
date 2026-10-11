//! Vendor-official skills for the third-party services a project calls.
//!
//! Every source, skill id, and install count is transcribed from the
//! vendor-official table in `docs/research/2026-07-25-todo-191-command-provenance.md`.

use crate::setup_advisor::detections::Field;
use crate::setup_advisor::rule::{Evidence, Rule};

use super::common::vendor;

/// Vendor-official skills for the services the project calls.
pub(super) static RULES: &[Rule] = &[
    // Command: provenance doc, vendor-official table, `stripe/ai`.
    vendor(super::common::RegistryRule {
        id: "skills-stripe",
        title: "Stripe best practices",
        why: "Stripe's own skill, so payment code gets idempotency and webhooks right.",
        command: "npx skills add stripe/ai --skill stripe-best-practices -a claude-code -g -y",
        repo: "stripe/ai",
        installs: 62_548,
        priority: 20,
        evidence: Evidence::Detected(
            Field::ExternalApi,
            "stripe",
            "stripe in package.json dependencies",
        ),
    }),
    // Command: provenance doc, vendor-official table, `clerk/skills`.
    vendor(super::common::RegistryRule {
        id: "skills-clerk",
        title: "Clerk skill",
        why: "Clerk's own skill, so auth flows and middleware match its current API.",
        command: "npx skills add clerk/skills --skill clerk -a claude-code -g -y",
        repo: "clerk/skills",
        installs: 19_348,
        priority: 21,
        evidence: Evidence::Detected(
            Field::ExternalApi,
            "clerk",
            "a @clerk/* dependency in package.json",
        ),
    }),
    // Command: provenance doc, vendor-official table, `auth0/agent-skills`.
    vendor(super::common::RegistryRule {
        id: "skills-auth0",
        title: "Auth0 quickstart",
        why: "Auth0's own quickstart, so login and token handling follow current guidance.",
        command: "npx skills add auth0/agent-skills --skill auth0-quickstart -a claude-code -g -y",
        repo: "auth0/agent-skills",
        installs: 2_663,
        priority: 22,
        evidence: Evidence::Detected(
            Field::ExternalApi,
            "auth0",
            "an @auth0/* dependency in package.json",
        ),
    }),
    // Command: provenance doc, vendor-official table, `langchain-ai/langchain-skills`.
    vendor(super::common::RegistryRule {
        id: "skills-langchain",
        title: "LangChain RAG skill",
        why: "LangChain's own RAG skill, so retrieval chains follow the framework's patterns.",
        command: "npx skills add langchain-ai/langchain-skills --skill langchain-rag -a claude-code -g -y",
        repo: "langchain-ai/langchain-skills",
        installs: 11_706,
        priority: 23,
        evidence: Evidence::Detected(
            Field::ExternalApi,
            "langchain",
            "langchain in the project's dependencies",
        ),
    }),
    // Command: provenance doc, vendor-official table, `openai/skills`.
    vendor(super::common::RegistryRule {
        id: "skills-openai",
        title: "OpenAI docs skill",
        why: "OpenAI's own docs skill, so API calls match the current SDK, not a remembered one.",
        command: "npx skills add openai/skills --skill openai-docs -a claude-code -g -y",
        repo: "openai/skills",
        installs: 3_438,
        priority: 24,
        evidence: Evidence::Detected(
            Field::ExternalApi,
            "openai",
            "openai in the project's dependencies",
        ),
    }),
    // Command: provenance doc, vendor-official table, `aws/agent-toolkit-for-aws`.
    vendor(super::common::RegistryRule {
        id: "skills-aws",
        title: "AWS IAM skill",
        why: "AWS's own IAM skill, so the policies the agent writes stay least-privilege.",
        command: "npx skills add aws/agent-toolkit-for-aws --skill aws-iam -a claude-code -g -y",
        repo: "aws/agent-toolkit-for-aws",
        installs: 4_251,
        priority: 25,
        evidence: Evidence::Detected(
            Field::ExternalApi,
            "aws",
            "an @aws-sdk/* dependency in package.json",
        ),
    }),
    // Command: provenance doc, vendor-official table, `getsentry/sentry-for-ai`.
    vendor(super::common::RegistryRule {
        id: "skills-sentry",
        title: "Sentry workflow skill",
        why: "Sentry's own workflow skill, so the agent can trace an alert to the code.",
        command: "npx skills add getsentry/sentry-for-ai --skill sentry-workflow -a claude-code -g -y",
        repo: "getsentry/sentry-for-ai",
        installs: 3_407,
        priority: 26,
        evidence: Evidence::Detected(
            Field::ExternalApi,
            "sentry",
            "a @sentry/* dependency in package.json",
        ),
    }),
];
