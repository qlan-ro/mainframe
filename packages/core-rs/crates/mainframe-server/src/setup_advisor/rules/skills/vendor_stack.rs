//! Vendor-official skills for the stack a project is built on: frameworks, the
//! data layer, and test runners.
//!
//! Every source, skill id, and install count is transcribed from the
//! vendor-official table in `docs/research/2026-07-25-todo-191-command-provenance.md`.

use mainframe_types::setup_advisor::ProjectFingerprint;

use crate::setup_advisor::rule::Rule;

use super::common::{detected, vendor};

fn react(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.frameworks,
        "react",
        "react in package.json dependencies",
    )
}

fn vue(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.frameworks, "vue", "vue in package.json dependencies")
}

fn svelte(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.frameworks,
        "svelte",
        "svelte in package.json dependencies",
    )
}

fn fastapi(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.frameworks,
        "fastapi",
        "fastapi in the project's Python dependencies",
    )
}

fn supabase(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.databases,
        "supabase",
        "a @supabase/* dependency in package.json",
    )
}

fn postgres(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.databases,
        "postgres",
        "a pg or postgres dependency in package.json",
    )
}

fn prisma(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.databases,
        "prisma",
        "prisma in package.json dependencies",
    )
}

fn convex(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.databases,
        "convex",
        "convex in package.json dependencies",
    )
}

fn vitest(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.testing, "vitest", "vitest in package.json dependencies")
}

fn playwright(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.testing,
        "playwright",
        "a playwright dependency in package.json",
    )
}

// Command: provenance doc, vendor-official table, `vercel-labs/agent-skills`.
pub(super) const REACT: Rule = vendor(
    "skills-react",
    "React best practices",
    "React patterns from Vercel's own skill, applied while the agent writes components.",
    "npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices -a claude-code -g -y",
    "vercel-labs/agent-skills",
    578_336,
    10,
    react,
);

// Command: provenance doc, vendor-official table, `antfu/skills` (Vue core team).
pub(super) const VUE: Rule = vendor(
    "skills-vue",
    "Vue best practices",
    "Vue idioms from a Vue core maintainer, so generated components fit the framework.",
    "npx skills add antfu/skills --skill vue -a claude-code -g -y",
    "antfu/skills",
    30_277,
    11,
    vue,
);

// Command: provenance doc, vendor-official table, `sveltejs/ai-tools`.
pub(super) const SVELTE: Rule = vendor(
    "skills-svelte",
    "Svelte code writer",
    "The Svelte team's own writing guidance, so components use current Svelte syntax.",
    "npx skills add sveltejs/ai-tools --skill svelte-code-writer -a claude-code -g -y",
    "sveltejs/ai-tools",
    6_753,
    12,
    svelte,
);

// Command: provenance doc, vendor-official table, `fastapi/fastapi`.
pub(super) const FASTAPI: Rule = vendor(
    "skills-fastapi",
    "FastAPI skill",
    "FastAPI's own skill, so routes and dependencies come out idiomatic the first time.",
    "npx skills add fastapi/fastapi --skill fastapi -a claude-code -g -y",
    "fastapi/fastapi",
    6_160,
    13,
    fastapi,
);

// Command: provenance doc, vendor-official table, `supabase/agent-skills`.
pub(super) const SUPABASE: Rule = vendor(
    "skills-supabase",
    "Supabase skill",
    "Supabase's own guidance for auth, row-level security, and client usage.",
    "npx skills add supabase/agent-skills --skill supabase -a claude-code -g -y",
    "supabase/agent-skills",
    182_151,
    14,
    supabase,
);

// Command: provenance doc, vendor-official table. No `postgres/` owner exists in
// the registry, so this row is Supabase's — the copy must not imply otherwise.
pub(super) const POSTGRES: Rule = vendor(
    "skills-postgres",
    "Postgres best practices",
    "Schema, index, and query guidance for Postgres, written by the Supabase team.",
    "npx skills add supabase/agent-skills --skill supabase-postgres-best-practices -a claude-code -g -y",
    "supabase/agent-skills",
    305_878,
    15,
    postgres,
);

// Command: provenance doc, vendor-official table, `prisma/skills`.
pub(super) const PRISMA: Rule = vendor(
    "skills-prisma",
    "Prisma database setup",
    "Prisma's own setup skill, so schema and client work follow the shape it expects.",
    "npx skills add prisma/skills --skill prisma-database-setup -a claude-code -g -y",
    "prisma/skills",
    51_296,
    16,
    prisma,
);

// Command: provenance doc, vendor-official table, `get-convex/agent-skills`.
pub(super) const CONVEX: Rule = vendor(
    "skills-convex",
    "Convex skill",
    "Convex's own skill, so queries, mutations, and schema follow its reactive model.",
    "npx skills add get-convex/agent-skills --skill convex -a claude-code -g -y",
    "get-convex/agent-skills",
    66_983,
    17,
    convex,
);

// Command: provenance doc, vendor-official table, `antfu/skills` (Vitest core team).
pub(super) const VITEST: Rule = vendor(
    "skills-vitest",
    "Vitest skill",
    "Vitest guidance from a Vitest core maintainer, applied as the agent writes tests.",
    "npx skills add antfu/skills --skill vitest -a claude-code -g -y",
    "antfu/skills",
    29_134,
    18,
    vitest,
);

// Command: provenance doc, vendor-official table, `microsoft/playwright-cli`.
pub(super) const PLAYWRIGHT: Rule = vendor(
    "skills-playwright",
    "Playwright CLI skill",
    "Microsoft's own skill, so specs use current locator and assertion APIs.",
    "npx skills add microsoft/playwright-cli --skill playwright-cli -a claude-code -g -y",
    "microsoft/playwright-cli",
    97_558,
    19,
    playwright,
);
