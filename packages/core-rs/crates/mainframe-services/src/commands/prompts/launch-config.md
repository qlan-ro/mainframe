Analyze this project and generate a .mainframe/launch.json file that defines how to run its development processes.

## Your task

1. Read the project's configuration files to understand its structure:
   - package.json (scripts, workspaces), pnpm-workspace.yaml, turbo.json, nx.json, lerna.json
   - vite.config.*, next.config.*, webpack.config.*, astro.config.*
   - Makefile, Justfile, Dockerfile, docker-compose.yml
   - pom.xml, build.gradle, build.gradle.kts
   - Cargo.toml, go.mod, pyproject.toml, requirements.txt, manage.py
   - the README, for the run instructions a human is given

2. NEVER read .env, .env.local, .env.*, or any file listed in .gitignore. You do not need
   to: reference those values as `${VAR:-default}` and the daemon resolves them when it
   parses the file. Never copy a secret into launch.json — it gets committed.

3. Identify all long-running development processes (dev servers, watchers, backing
   services). Skip tests, linters, and one-shot builds.

4. Create the .mainframe directory if it doesn't exist, then write .mainframe/launch.json.

5. Do not start any process. Writing the file is the whole task; the user starts
   processes from the Run panel.

## Output schema

The file must be valid JSON matching this exact schema:

```json
{
  "version": "1",
  "configurations": [
    {
      "name": "Human-readable process name",
      "runtimeExecutable": "executable-name",
      "runtimeArgs": ["arg1", "arg2"],
      "port": "${PORT:-3000}",
      "url": null,
      "preview": true,
      "env": {
        "NODE_ENV": "development"
      }
    }
  ]
}
```

### Field rules — follow these EXACTLY

- **version** (required): the STRING "1". The number 1 fails validation.
- **name** (required string): unique, descriptive, e.g. "API Server", "Frontend Dev",
  "Type Checker". It is the key the UI starts and stops.
- **runtimeExecutable** (required string): a SINGLE executable — no spaces, no arguments,
  and none of `;`, `|`, `&`. Only letters, digits, `_`, `-`, `.`, `/`. Arguments go in
  runtimeArgs. WRONG: "docker compose up". RIGHT: "docker" with
  runtimeArgs: ["compose", "up"].
- **runtimeArgs** (string array): arguments passed to the executable. Omitted means [].
- **port** (number, string, or null): a literal port is a JSON number (`3000`). A port
  that comes from the environment is a string with a default (`"${PORT:-3000}"`), parsed
  as a positive integer after expansion. Use `null` when the process does not listen on a
  port. Never use `0`.
- **url** (string or null, optional): a display URL. Omit it or set null when there is
  none.
- **preview** (optional boolean): set true on exactly ONE configuration — the main web UI
  the developer wants to preview. Omit it on the others.
- **env** (optional object): keys must match `^[A-Za-z_][A-Za-z0-9_]*$` (UPPER_SNAKE_CASE
  by convention); values are coerced to strings. Only include what the process needs to
  run. Never copy values out of .env files — reference them as `${VAR:-default}`.

## How the daemon runs these processes

These decide whether a configuration works. Most broken configs violate one of them.

- **There is no `cwd` field. Every process runs from the project root.** A process that
  lives in a subdirectory must say so in its arguments: `pnpm --filter <pkg> run dev`,
  `npm --workspace <dir> run dev`, `npm --prefix <dir> run dev`, `make -C <dir> <target>`,
  `cargo run -p <crate>`, `docker compose -f <path> up`. A `cwd` key is ignored.
- **`port` injects `PORT` into the process and gates readiness.** The daemon polls a TCP
  connect to localhost:port every second and reports "running" only once it connects. A
  port the process does not listen on leaves it "starting" for 60 seconds. If you cannot
  determine a port with certainty, use null rather than guessing.
- **`preview: true` plus a port produces the shareable preview URL.** Preview without a
  port gets no tunnel.
- **Variable expansion** applies to every string: `${VAR}` and `${VAR:-default}` resolve
  against the daemon environment and then the project's .env; a leading `~` or `~/`
  becomes the home directory. An unresolved `${VAR}` with no default rejects the WHOLE
  file, so always supply a default.
- **The process environment is rebuilt, not inherited from a shell.** Exports from
  .zshrc/.bashrc do not reach it; PATH is resolved from the login shell. A variable the
  process needs must be declared in `env`.
- **Relative executables resolve against the project root** (`./gradlew`, `./mvnw`,
  `../bin/tool`). A bare name is looked up on PATH.
- Validation is all-or-nothing: one bad configuration removes every configuration from the
  Run panel.

## Common patterns

- **pnpm monorepo**: runtimeExecutable "pnpm", runtimeArgs ["--filter", "@scope/pkg", "run", "dev"]
- **npm workspaces**: "npm", ["--workspace", "packages/api", "run", "dev"]
- **npm project**: "npm", ["run", "dev"]
- **Vite/Next.js/CRA**: use the dev script, set preview: true, take the port from the config
- **Express/Fastify/Koa**: backend API server, set the port it listens on
- **Java (Gradle)**: "./gradlew", ["bootRun"]
- **Java (Maven)**: "./mvnw", ["spring-boot:run"]
- **Python/Django**: "python3", ["manage.py", "runserver", "0.0.0.0:8000"]
- **Go**: "go", ["run", "./cmd/server"]
- **Cargo**: "cargo", ["run", "-p", "my-crate"]
- **Docker Compose**: "docker", ["compose", "up"]
- **Type/build watchers**: include them with port: null and no preview

## Guidelines

- Include ALL processes needed for a full dev environment, not just the main one.
- For monorepos, include each workspace's dev process separately.
- Prefer dev/watch mode scripts over build scripts.
- Verify every script or target you reference actually exists in package.json, the
  Makefile, or wherever you found it.
- Keep env minimal — only override what's necessary to run correctly.
