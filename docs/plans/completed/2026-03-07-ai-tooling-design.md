# AI Tooling Panel — Design Document

**Date**: 2026-03-07
**Feature**: AI Tooling (last feature for 0.2.0 release)
**Inspiration**: [Agent Audit (LobeHub)](https://lobehub.com/skills/mdmagnuson-creator-yo-go-agent-audit)

## Context

Mainframe's README promises "AI tools management — Makes sure your project is AI ready. Handling Subagents, Skills, MCPs, context files." The Skills & Agents CRUD backend exists (`/api/skills`, `/api/agents`), but there's no unified panel for managing the full AI tooling ecosystem: no catalog browsing, no MCP management, no readiness analysis. This feature completes that vision as the final 0.2.0 deliverable.

## Architecture

**UI**: Dedicated left-sidebar panel ("Toolkit") with 4 tabs: Skills, Agents, MCPs, Readiness.

**Backend**: New route group `/api/projects/:projectId/toolkit/...` in the daemon. CLI operations via `execFile` with array args (no shell interpolation).

**Integration**: CLI-wrapper approach — shell out to skills.sh CLI tools (`npx skillsadd`) for catalog operations. Direct file I/O for MCP config. AI provider for readiness analysis.

**Data flow**: `UI <-> Daemon HTTP/WS <-> (skills.sh CLI | file system | MCP process spawn | AI provider)`

---

## Tab 1: Skills

### Browse & Search
- Daemon fetches skills.sh catalog via CLI (`npx skillsadd` or equivalent non-interactive command)
- Cache results in daemon memory with 1-hour TTL
- UI: searchable/filterable grid — name, description, category, install count
- Filter by category (dev, marketing, design, etc.) and platform compatibility

### Install
- User clicks "Install" → daemon runs `npx skillsadd <skill-name>` with `--dir` pointing to project's `.claude/skills/`
- Real-time output streamed to UI via WebSocket
- On completion, refresh installed skills list

### Manage (existing functionality, surfaced in new panel)
- List installed project + global skills (existing `/api/skills` endpoint)
- Edit in Monaco editor (existing feature)
- Remove skill (existing delete endpoint)

### Suggestions
- Powered by the Readiness tab's AI analysis (see Tab 4)
- Shows "Recommended for your stack" section at top of Skills tab
- Populated after a readiness scan has been run

### Key files to reuse
- `packages/core/src/server/routes/skills.ts` — existing CRUD routes
- `packages/core/src/plugins/builtin/claude/skills.ts` — file system scanning, frontmatter parsing
- `packages/types/src/skill.ts` — `Skill`, `CreateSkillInput` types
- `packages/desktop/src/renderer/store/skills.ts` — existing skills store

---

## Tab 2: Agents

### List & CRUD (existing functionality, surfaced in new panel)
- List project + global agents (existing `/api/agents` endpoint)
- Create, edit (Monaco), delete agents

### Agent Templates
- Built-in templates shipped with Mainframe core (e.g., `code-reviewer`, `test-writer`, `refactorer`, `documenter`)
- Each template = markdown file with frontmatter (same format as Claude agents)
- Templates stored in `packages/core/src/templates/agents/`
- UI: template gallery → "Use Template" → copies to project's `.claude/agents/` with option to customize before saving

### Key files to reuse
- `packages/core/src/server/routes/agents.ts` — existing CRUD routes
- `packages/types/src/skill.ts` — `AgentConfig`, `CreateAgentInput` types

---

## Tab 3: MCPs

### List
- Parse MCP config from `.claude/settings.json` (`mcpServers` key) and project-level `.claude/settings.local.json`
- Display each MCP: name, command, args, env vars (masked), scope (global/project)

### Add
- Form UI: name, command (`npx`, `node`, `python`, etc.), args array, env vars
- Writes to appropriate settings file
- Optionally run health check immediately after adding

### Remove
- Delete entry from settings file
- Confirm dialog (destructive action)

### Health Check
- Spawn MCP server process briefly
- Send JSON-RPC `initialize` request
- Check for valid response within 5-second timeout
- Show status: healthy / unhealthy / timeout
- Kill process after check

### Key files to create
- `packages/core/src/toolkit/mcp-manager.ts` — parse/write MCP settings, spawn health checks
- `packages/core/src/server/routes/toolkit-mcps.ts` — API routes
- `packages/types/src/mcp.ts` — `McpServerConfig`, `McpHealthStatus` types

---

## Tab 4: Readiness (AI-Powered)

### How it works
- Mainframe ships a hardcoded **readiness skill/prompt** in core
- When user triggers "Scan Project", daemon sends this prompt to one of the configured AI providers along with project context (file tree, key config files like `package.json`, `CLAUDE.md`, etc.)
- The AI analyzes the project and returns structured recommendations: detected stack, recommended skills/agents/MCPs, identified gaps
- Daemon parses the structured response → UI renders the readiness report

### UI
- "Scan" button → progress indicator → AI-generated analysis
- Results grouped by: Skills, Agents, MCPs — each with install/configure quick actions
- "Install All Recommended" batch action for missing skills
- Click any recommendation → navigates to relevant tab with item pre-selected
- Option to re-scan after changes

### Provider Selection
- Uses whichever AI provider is available/configured for the current project
- Falls back gracefully if no provider is set up (show setup prompt)

### Key files to create
- `packages/core/src/toolkit/readiness.ts` — readiness prompt, context gathering, response parsing
- `packages/core/src/server/routes/toolkit-readiness.ts` — API route for scan trigger
- Hardcoded prompt template in `packages/core/src/toolkit/prompts/readiness.md`

---

## New Types (packages/types)

```typescript
// mcp.ts
interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  scope: 'global' | 'project';
  filePath: string; // source settings file
}

interface McpHealthResult {
  name: string;
  status: 'healthy' | 'unhealthy' | 'timeout';
  responseTimeMs?: number;
  error?: string;
}

// toolkit.ts
interface SkillsCatalogEntry {
  name: string;
  description: string;
  category: string;
  platforms: string[];
  installCount: number;
  installed: boolean;
}

interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  content: string; // markdown with frontmatter
}

interface ReadinessReport {
  detectedStack: string[];
  recommendations: {
    skills: { name: string; reason: string; catalogEntry?: SkillsCatalogEntry }[];
    agents: { name: string; reason: string; template?: string }[];
    mcps: { name: string; reason: string; command?: string }[];
  };
  configured: { skills: string[]; agents: string[]; mcps: string[] };
  score: { configured: number; total: number };
}
```

## New Route Group

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/projects/:id/toolkit/catalog` | Fetch skills.sh catalog (cached) |
| POST | `/api/projects/:id/toolkit/skills/install` | Install skill from catalog |
| GET | `/api/projects/:id/toolkit/mcps` | List configured MCPs |
| POST | `/api/projects/:id/toolkit/mcps` | Add MCP |
| DELETE | `/api/projects/:id/toolkit/mcps/:name` | Remove MCP |
| POST | `/api/projects/:id/toolkit/mcps/:name/health` | Health check single MCP |
| POST | `/api/projects/:id/toolkit/mcps/health` | Health check all MCPs |
| GET | `/api/projects/:id/toolkit/templates/agents` | List agent templates |
| POST | `/api/projects/:id/toolkit/templates/agents/:id/install` | Install agent template |
| POST | `/api/projects/:id/toolkit/readiness/scan` | Trigger AI readiness scan |

---

## Desktop Components

```
packages/desktop/src/renderer/components/toolkit/
  ToolkitPanel.tsx          — Main panel with tab navigation
  SkillsTab.tsx             — Browse, search, install, manage skills
  SkillsCatalogGrid.tsx     — Catalog display grid
  AgentsTab.tsx             — Agents CRUD + template gallery
  AgentTemplateCard.tsx     — Single template display
  McpsTab.tsx               — MCP list, add, remove, health
  McpAddForm.tsx            — Form for adding new MCP
  McpHealthBadge.tsx        — Health status indicator
  ReadinessTab.tsx          — Scan trigger + results display
  ReadinessReport.tsx       — Structured readiness results
```

---

## Verification

1. **Skills catalog**: Open Toolkit → Skills tab → verify catalog loads, search/filter works, install a skill, verify it appears in installed list
2. **Agent templates**: Open Agents tab → browse templates → install one → verify it appears in project's `.claude/agents/`
3. **MCP management**: Open MCPs tab → verify configured MCPs are listed → add a new MCP → health check it → remove it
4. **Readiness scan**: Open Readiness tab → trigger scan → verify AI analysis returns structured results → click a recommendation → verify navigation to correct tab
5. **Run existing tests**: `pnpm --filter @qlan-ro/mainframe-core test` — ensure no regressions
6. **New tests**: Unit tests for MCP config parsing, catalog caching, readiness prompt/response parsing
