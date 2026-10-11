//! Vendor-official skills for the stack a project is built on: frameworks, the
//! data layer, and test runners.
//!
//! Every source, skill id, and install count is transcribed from the
//! vendor-official table in `docs/research/2026-07-25-todo-191-command-provenance.md`.

use crate::setup_advisor::detections::Field;
use crate::setup_advisor::rule::{Evidence, Rule};

use super::common::vendor;

/// Vendor-official skills for the stack the project is built on.
pub(super) static RULES: &[Rule] = &[
    // Command: provenance doc, vendor-official table, `vercel-labs/agent-skills`.
    vendor(super::common::RegistryRule {
        id: "skills-react",
        title: "React best practices",
        why: "React patterns from Vercel's own skill, applied while the agent writes components.",
        command: "npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices -a claude-code -g -y",
        repo: "vercel-labs/agent-skills",
        installs: 578_336,
        priority: 10,
        evidence: Evidence::Detected(
            Field::Framework,
            "react",
            "react in package.json dependencies",
        ),
    }),
    // Command: provenance doc, vendor-official table, `antfu/skills` (Vue core team).
    vendor(super::common::RegistryRule {
        id: "skills-vue",
        title: "Vue best practices",
        why: "Vue idioms from a Vue core maintainer, so generated components fit the framework.",
        command: "npx skills add antfu/skills --skill vue -a claude-code -g -y",
        repo: "antfu/skills",
        installs: 30_277,
        priority: 11,
        evidence: Evidence::Detected(Field::Framework, "vue", "vue in package.json dependencies"),
    }),
    // Command: provenance doc, vendor-official table, `sveltejs/ai-tools`.
    vendor(super::common::RegistryRule {
        id: "skills-svelte",
        title: "Svelte code writer",
        why: "The Svelte team's own writing guidance, so components use current Svelte syntax.",
        command: "npx skills add sveltejs/ai-tools --skill svelte-code-writer -a claude-code -g -y",
        repo: "sveltejs/ai-tools",
        installs: 6_753,
        priority: 12,
        evidence: Evidence::Detected(
            Field::Framework,
            "svelte",
            "svelte in package.json dependencies",
        ),
    }),
    // Command: provenance doc, vendor-official table, `fastapi/fastapi`.
    vendor(super::common::RegistryRule {
        id: "skills-fastapi",
        title: "FastAPI skill",
        why: "FastAPI's own skill, so routes and dependencies come out idiomatic the first time.",
        command: "npx skills add fastapi/fastapi --skill fastapi -a claude-code -g -y",
        repo: "fastapi/fastapi",
        installs: 6_160,
        priority: 13,
        evidence: Evidence::Detected(
            Field::Framework,
            "fastapi",
            "fastapi in the project's Python dependencies",
        ),
    }),
    // Command: provenance doc, vendor-official table, `supabase/agent-skills`.
    vendor(super::common::RegistryRule {
        id: "skills-supabase",
        title: "Supabase skill",
        why: "Supabase's own guidance for auth, row-level security, and client usage.",
        command: "npx skills add supabase/agent-skills --skill supabase -a claude-code -g -y",
        repo: "supabase/agent-skills",
        installs: 182_151,
        priority: 14,
        evidence: Evidence::Detected(
            Field::Database,
            "supabase",
            "a @supabase/* dependency in package.json",
        ),
    }),
    // Command: provenance doc, vendor-official table. No `postgres/` owner exists in
    // the registry, so this row is Supabase's — the copy must not imply otherwise.
    vendor(super::common::RegistryRule {
        id: "skills-postgres",
        title: "Postgres best practices",
        why: "Schema, index, and query guidance for Postgres, written by the Supabase team.",
        command: "npx skills add supabase/agent-skills --skill supabase-postgres-best-practices -a claude-code -g -y",
        repo: "supabase/agent-skills",
        installs: 305_878,
        priority: 15,
        evidence: Evidence::Detected(
            Field::Database,
            "postgres",
            "a pg or postgres dependency in package.json",
        ),
    }),
    // Command: provenance doc, vendor-official table, `prisma/skills`.
    vendor(super::common::RegistryRule {
        id: "skills-prisma",
        title: "Prisma database setup",
        why: "Prisma's own setup skill, so schema and client work follow the shape it expects.",
        command: "npx skills add prisma/skills --skill prisma-database-setup -a claude-code -g -y",
        repo: "prisma/skills",
        installs: 51_296,
        priority: 16,
        evidence: Evidence::Detected(
            Field::Database,
            "prisma",
            "prisma in package.json dependencies",
        ),
    }),
    // Command: provenance doc, vendor-official table, `get-convex/agent-skills`.
    vendor(super::common::RegistryRule {
        id: "skills-convex",
        title: "Convex skill",
        why: "Convex's own skill, so queries, mutations, and schema follow its reactive model.",
        command: "npx skills add get-convex/agent-skills --skill convex -a claude-code -g -y",
        repo: "get-convex/agent-skills",
        installs: 66_983,
        priority: 17,
        evidence: Evidence::Detected(
            Field::Database,
            "convex",
            "convex in package.json dependencies",
        ),
    }),
    // Command: provenance doc, vendor-official table, `antfu/skills` (Vitest core team).
    vendor(super::common::RegistryRule {
        id: "skills-vitest",
        title: "Vitest skill",
        why: "Vitest guidance from a Vitest core maintainer, applied as the agent writes tests.",
        command: "npx skills add antfu/skills --skill vitest -a claude-code -g -y",
        repo: "antfu/skills",
        installs: 29_134,
        priority: 18,
        evidence: Evidence::Detected(
            Field::Testing,
            "vitest",
            "vitest in package.json dependencies",
        ),
    }),
    // Command: provenance doc, vendor-official table, `microsoft/playwright-cli`.
    vendor(super::common::RegistryRule {
        id: "skills-playwright",
        title: "Playwright CLI skill",
        why: "Microsoft's own skill, so specs use current locator and assertion APIs.",
        command: "npx skills add microsoft/playwright-cli --skill playwright-cli -a claude-code -g -y",
        repo: "microsoft/playwright-cli",
        installs: 97_558,
        priority: 19,
        evidence: Evidence::Detected(
            Field::Testing,
            "playwright",
            "a playwright dependency in package.json",
        ),
    }),
];
