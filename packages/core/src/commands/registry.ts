import type { CustomCommand } from '@mainframe/types';

const LAUNCH_CONFIG_PROMPT = `\
Analyze this project and generate a .mainframe/launch.json file that defines how to run its development processes.

## Your task

1. Read the project's configuration files to understand its structure:
   - package.json (scripts, workspaces), pnpm-workspace.yaml, lerna.json
   - vite.config.*, next.config.*, webpack.config.*
   - Makefile, Dockerfile, docker-compose.yml
   - pom.xml, build.gradle, build.gradle.kts
   - Cargo.toml, go.mod, pyproject.toml, requirements.txt
   - Any other build/run configuration files at the project root

2. NEVER read .env, .env.local, .env.*, or any file listed in .gitignore. Only use source-controlled files.

3. Identify all runnable development processes (dev servers, watchers, build tasks, backend services).

4. Create the .mainframe directory if it doesn't exist, then write .mainframe/launch.json.

## Output schema

The file must be valid JSON matching this exact schema:

\`\`\`json
{
  "version": "1",
  "configurations": [
    {
      "name": "Human-readable process name",
      "runtimeExecutable": "executable-name",
      "runtimeArgs": ["arg1", "arg2"],
      "port": 3000,
      "url": null,
      "preview": true,
      "env": {
        "NODE_ENV": "development"
      }
    }
  ]
}
\`\`\`

### Field rules — follow these EXACTLY

- **name** (required string): Unique, descriptive name like "API Server", "Frontend Dev", "Type Checker".
- **runtimeExecutable** (required string): A SINGLE executable name — no spaces, no arguments. Must match \`/^(node|pnpm|npm|yarn|bun|python|python3|java|gradle|mvn|cargo|go|make|docker|[a-zA-Z0-9_\\-./]+)$/\`. Arguments go in runtimeArgs, NOT here. WRONG: "docker compose up". RIGHT: "docker" with runtimeArgs: ["compose", "up"].
- **runtimeArgs** (required string[]): Arguments passed to the executable. For npm/pnpm scripts use ["run", "dev"] style. For docker compose use ["compose", "up"].
- **port** (number or null, REQUIRED): Must be a JSON number like 3000, NOT a string like "3000". Set to null (not 0, not omitted) if the process doesn't expose a port.
- **url** (string or null, REQUIRED): Must be present in every configuration. Set to null if not applicable. Do NOT omit this field.
- **preview** (optional boolean): Set true on exactly ONE configuration — the main web UI the developer wants to preview. Omit or set false on all others.
- **env** (optional object): Environment variables with UPPER_SNAKE_CASE keys. Only include variables needed to run the process (e.g. NODE_ENV, PORT overrides). Do NOT copy values from .env files.

## Common patterns

- **pnpm monorepo**: Use \`pnpm --filter @scope/pkg run dev\` → runtimeExecutable: "pnpm", runtimeArgs: ["--filter", "@scope/pkg", "run", "dev"]
- **npm project**: runtimeExecutable: "npm", runtimeArgs: ["run", "dev"]
- **Vite/Next.js/CRA**: Identify the dev script, set preview: true, infer port from config
- **Express/Fastify/Koa**: Backend API server, set the port it listens on
- **Java (Gradle)**: runtimeExecutable: "gradle" or "./gradlew", runtimeArgs: ["bootRun"]
- **Java (Maven)**: runtimeExecutable: "mvn" or "./mvnw", runtimeArgs: ["spring-boot:run"]
- **Python**: runtimeExecutable: "python3", runtimeArgs: ["manage.py", "runserver"]
- **Go**: runtimeExecutable: "go", runtimeArgs: ["run", "."]
- **Cargo**: runtimeExecutable: "cargo", runtimeArgs: ["run"]
- **Docker Compose**: runtimeExecutable: "docker", runtimeArgs: ["compose", "up"]
- **Type watchers / build watchers**: Include them with port: null, no preview

## Guidelines

- Include ALL processes needed for a full dev environment, not just the main one.
- For monorepos, include each workspace's dev process separately.
- Prefer dev/watch mode scripts over build scripts.
- If you can't determine a port with certainty, set it to null rather than guessing.
- Keep env minimal — only override what's necessary to run correctly.`;

const MAINFRAME_COMMANDS: CustomCommand[] = [
  {
    name: 'launch-config',
    description: 'Generate .mainframe/launch.json for this project',
    source: 'mainframe',
    promptTemplate: LAUNCH_CONFIG_PROMPT,
  },
];

export function getMainframeCommands(): CustomCommand[] {
  return MAINFRAME_COMMANDS;
}

export function findMainframeCommand(name: string): CustomCommand | undefined {
  return MAINFRAME_COMMANDS.find((c) => c.name === name);
}
