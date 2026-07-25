//! The eight custom-skill SKILL.md snippets, derived from the upstream
//! `claude-code-setup v1.0.0` bundle's
//! `skills/claude-automation-recommender/references/skills-reference.md`.
//!
//! Nothing here is vendored: the snippets are the rules' `command` text, which the
//! user pastes into a file their own repo owns. They are the one exception to the
//! "transcribe from the tool's documentation" rule — there is no tool.
//!
//! Where upstream split a skill across companion files — an OpenAPI template, a
//! `templates/` directory, a validation script — the bodies here are rewritten to
//! stand alone. The card writes exactly one file, so a body that reads a second
//! one sends the agent after something that has never existed.

pub(super) const API_DOC: &str = r#"---
name: api-doc
description: Generate OpenAPI documentation for an endpoint. Use when documenting API routes.
---

Generate OpenAPI documentation for the endpoint at $ARGUMENTS.

1. Read the endpoint code
2. Extract the path, method, parameters, and request and response schemas
3. Emit an OpenAPI 3.1 path item: `summary`, `parameters`, `requestBody`, and a
   `responses` entry for every status the handler can return
4. Match the style of the project's existing OpenAPI documents. If there are
   none, emit a whole document, with `openapi`, `info`, and `paths`
"#;

pub(super) const CREATE_MIGRATION: &str = r#"---
name: create-migration
description: Create a database migration file
disable-model-invocation: true
allowed-tools: Read, Write, Bash
---

Create a migration for: $ARGUMENTS

1. Read the most recent migration and follow its naming, format, and driver
2. Write the new migration in the same directory, with a timestamp prefix
3. Write both directions; the down must undo the up exactly, leaving no column,
   index, or constraint behind
4. Report anything the down cannot undo, such as data in a dropped column
"#;

pub(super) const GEN_TEST: &str = r#"---
name: gen-test
description: Generate tests for a file following project conventions
disable-model-invocation: true
---

Generate tests for: $ARGUMENTS

1. Analyze the source file
2. Read the nearest existing test file. Its runner, imports, layout, and naming
   are this project's conventions — follow them rather than a generic template
3. Cover each exported function's success path, its failure paths, and the
   boundaries of whatever it validates
4. Write the tests where the existing ones live
"#;

pub(super) const NEW_COMPONENT: &str = r#"---
name: new-component
description: Scaffold a new React component with tests and stories
disable-model-invocation: true
---

Create component: $ARGUMENTS

1. Read a neighbouring component and its test and story. Their file layout,
   imports, prop typing, and filename casing are the pattern to copy
2. Write the component, its test, and its story next to that neighbour
3. Give the test a real assertion about what the component renders, not a
   placeholder
"#;

pub(super) const PR_CHECK: &str = r#"---
name: pr-check
description: Review PR against project checklist
disable-model-invocation: true
context: fork
---

## PR Context
- Diff: !`gh pr diff`
- Description: !`gh pr view`

Review the diff against the checklist below, marking each item ✅ or ❌ with an
explanation. Edit the checklist to match what this project actually cares about.

1. The description says what changed and why
2. Every behaviour change is covered by a test that would fail without it
3. No secrets, credentials, or personal paths appear in the diff
4. Errors are handled or propagated, never swallowed
5. Public API changes ship with the documentation change
6. Nothing unrelated to the stated change is in the diff
"#;

pub(super) const RELEASE_NOTES: &str = r#"---
name: release-notes
description: Generate release notes from commits since last tag
disable-model-invocation: true
---

## Recent Changes
- Commits since last tag: !`git log $(git describe --tags --abbrev=0)..HEAD --oneline`
- Last tag: !`git describe --tags --abbrev=0`

Generate release notes:
1. Group commits by type (feat, fix, docs, etc.)
2. Write user-friendly descriptions
3. Highlight breaking changes
4. Format as markdown
"#;

pub(super) const PROJECT_CONVENTIONS: &str = r#"---
name: project-conventions
description: Code style and patterns for this project. Apply when writing or reviewing code.
user-invocable: false
---

TEMPLATE — nothing below has been filled in yet. This file is loaded on its own,
without anyone asking for it, so an invented rule here becomes one the agent
enforces on every file it touches. Replace each line with a convention this
project actually holds, and delete the sections it has none for. Until then this
file states no convention, and an unreplaced line is not one.

## Naming

- TODO: the casing this project uses for components, functions, constants, files

## Patterns

- TODO: how a fallible operation reports failure here
- TODO: the shape every API response takes
- TODO: the layering or composition rule this project keeps to

## Forbidden

- TODO: what review rejects on sight
"#;

pub(super) const SETUP_DEV: &str = r#"---
name: setup-dev
description: Set up development environment for new contributors
disable-model-invocation: true
---

Set up development environment:

1. Read the README for the required runtime and tool versions, then check each
   installed version against it and report every mismatch before going on
2. Install dependencies: `npm install`
3. Copy the environment template: `cp .env.example .env`
4. Set up the database: `npm run db:setup`
5. Verify the setup: `npm test`

Report any issues encountered.
"#;
