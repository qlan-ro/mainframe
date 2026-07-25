//! Vendor-official skills for the third-party services a project calls.
//!
//! Every source, skill id, and install count is transcribed from the
//! vendor-official table in `docs/research/2026-07-25-todo-191-command-provenance.md`.

use mainframe_types::setup_advisor::ProjectFingerprint;

use crate::setup_advisor::rule::Rule;

use super::common::{detected, vendor};

fn stripe(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.external_apis,
        "stripe",
        "stripe in package.json dependencies",
    )
}

fn clerk(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.external_apis,
        "clerk",
        "a @clerk/* dependency in package.json",
    )
}

fn auth0(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.external_apis,
        "auth0",
        "an @auth0/* dependency in package.json",
    )
}

fn langchain(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.external_apis,
        "langchain",
        "langchain in the project's dependencies",
    )
}

fn openai(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.external_apis,
        "openai",
        "openai in the project's dependencies",
    )
}

fn aws(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.external_apis,
        "aws",
        "an @aws-sdk/* dependency in package.json",
    )
}

fn sentry(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.external_apis,
        "sentry",
        "a @sentry/* dependency in package.json",
    )
}

// Command: provenance doc, vendor-official table, `stripe/ai`.
pub(super) const STRIPE: Rule = vendor(
    "skills-stripe",
    "Stripe best practices",
    "Stripe's own skill, so payment code gets idempotency and webhooks right.",
    "npx skills add stripe/ai --skill stripe-best-practices -a claude-code -g -y",
    "stripe/ai",
    62_548,
    20,
    stripe,
);

// Command: provenance doc, vendor-official table, `clerk/skills`.
pub(super) const CLERK: Rule = vendor(
    "skills-clerk",
    "Clerk skill",
    "Clerk's own skill, so auth flows and middleware match its current API.",
    "npx skills add clerk/skills --skill clerk -a claude-code -g -y",
    "clerk/skills",
    19_348,
    21,
    clerk,
);

// Command: provenance doc, vendor-official table, `auth0/agent-skills`.
pub(super) const AUTH0: Rule = vendor(
    "skills-auth0",
    "Auth0 quickstart",
    "Auth0's own quickstart, so login and token handling follow current guidance.",
    "npx skills add auth0/agent-skills --skill auth0-quickstart -a claude-code -g -y",
    "auth0/agent-skills",
    2_663,
    22,
    auth0,
);

// Command: provenance doc, vendor-official table, `langchain-ai/langchain-skills`.
pub(super) const LANGCHAIN: Rule = vendor(
    "skills-langchain",
    "LangChain RAG skill",
    "LangChain's own RAG skill, so retrieval chains follow the framework's patterns.",
    "npx skills add langchain-ai/langchain-skills --skill langchain-rag -a claude-code -g -y",
    "langchain-ai/langchain-skills",
    11_706,
    23,
    langchain,
);

// Command: provenance doc, vendor-official table, `openai/skills`.
pub(super) const OPENAI: Rule = vendor(
    "skills-openai",
    "OpenAI docs skill",
    "OpenAI's own docs skill, so API calls match the current SDK, not a remembered one.",
    "npx skills add openai/skills --skill openai-docs -a claude-code -g -y",
    "openai/skills",
    3_438,
    24,
    openai,
);

// Command: provenance doc, vendor-official table, `aws/agent-toolkit-for-aws`.
pub(super) const AWS: Rule = vendor(
    "skills-aws",
    "AWS IAM skill",
    "AWS's own IAM skill, so the policies the agent writes stay least-privilege.",
    "npx skills add aws/agent-toolkit-for-aws --skill aws-iam -a claude-code -g -y",
    "aws/agent-toolkit-for-aws",
    4_251,
    25,
    aws,
);

// Command: provenance doc, vendor-official table, `getsentry/sentry-for-ai`.
pub(super) const SENTRY: Rule = vendor(
    "skills-sentry",
    "Sentry workflow skill",
    "Sentry's own workflow skill, so the agent can trace an alert to the code.",
    "npx skills add getsentry/sentry-for-ai --skill sentry-workflow -a claude-code -g -y",
    "getsentry/sentry-for-ai",
    3_407,
    26,
    sentry,
);
