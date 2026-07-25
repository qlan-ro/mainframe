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
    vendor(
        "skills-stripe",
        "Stripe best practices",
        "Stripe's own skill, so payment code gets idempotency and webhooks right.",
        "npx skills add stripe/ai --skill stripe-best-practices -a claude-code -g -y",
        "stripe/ai",
        62_548,
        20,
        Evidence::Detected(
            Field::ExternalApi,
            "stripe",
            "stripe in package.json dependencies",
        ),
    ),
    // Command: provenance doc, vendor-official table, `clerk/skills`.
    vendor(
        "skills-clerk",
        "Clerk skill",
        "Clerk's own skill, so auth flows and middleware match its current API.",
        "npx skills add clerk/skills --skill clerk -a claude-code -g -y",
        "clerk/skills",
        19_348,
        21,
        Evidence::Detected(
            Field::ExternalApi,
            "clerk",
            "a @clerk/* dependency in package.json",
        ),
    ),
    // Command: provenance doc, vendor-official table, `auth0/agent-skills`.
    vendor(
        "skills-auth0",
        "Auth0 quickstart",
        "Auth0's own quickstart, so login and token handling follow current guidance.",
        "npx skills add auth0/agent-skills --skill auth0-quickstart -a claude-code -g -y",
        "auth0/agent-skills",
        2_663,
        22,
        Evidence::Detected(
            Field::ExternalApi,
            "auth0",
            "an @auth0/* dependency in package.json",
        ),
    ),
    // Command: provenance doc, vendor-official table, `langchain-ai/langchain-skills`.
    vendor(
        "skills-langchain",
        "LangChain RAG skill",
        "LangChain's own RAG skill, so retrieval chains follow the framework's patterns.",
        "npx skills add langchain-ai/langchain-skills --skill langchain-rag -a claude-code -g -y",
        "langchain-ai/langchain-skills",
        11_706,
        23,
        Evidence::Detected(
            Field::ExternalApi,
            "langchain",
            "langchain in the project's dependencies",
        ),
    ),
    // Command: provenance doc, vendor-official table, `openai/skills`.
    vendor(
        "skills-openai",
        "OpenAI docs skill",
        "OpenAI's own docs skill, so API calls match the current SDK, not a remembered one.",
        "npx skills add openai/skills --skill openai-docs -a claude-code -g -y",
        "openai/skills",
        3_438,
        24,
        Evidence::Detected(
            Field::ExternalApi,
            "openai",
            "openai in the project's dependencies",
        ),
    ),
    // Command: provenance doc, vendor-official table, `aws/agent-toolkit-for-aws`.
    vendor(
        "skills-aws",
        "AWS IAM skill",
        "AWS's own IAM skill, so the policies the agent writes stay least-privilege.",
        "npx skills add aws/agent-toolkit-for-aws --skill aws-iam -a claude-code -g -y",
        "aws/agent-toolkit-for-aws",
        4_251,
        25,
        Evidence::Detected(
            Field::ExternalApi,
            "aws",
            "an @aws-sdk/* dependency in package.json",
        ),
    ),
    // Command: provenance doc, vendor-official table, `getsentry/sentry-for-ai`.
    vendor(
        "skills-sentry",
        "Sentry workflow skill",
        "Sentry's own workflow skill, so the agent can trace an alert to the code.",
        "npx skills add getsentry/sentry-for-ai --skill sentry-workflow -a claude-code -g -y",
        "getsentry/sentry-for-ai",
        3_407,
        26,
        Evidence::Detected(
            Field::ExternalApi,
            "sentry",
            "a @sentry/* dependency in package.json",
        ),
    ),
];
