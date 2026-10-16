use super::*;

fn claude() -> Distribution {
    distribution("claude").unwrap()
}

fn codex() -> Distribution {
    distribution("codex").unwrap()
}

fn loc(path: &str, canonical: &str) -> Located {
    Located {
        path: path.to_string(),
        canonical: canonical.to_string(),
        home: Some("/Users/me".to_string()),
    }
}

fn args(command: &CommandSpec) -> Vec<&str> {
    command.args.iter().map(String::as_str).collect()
}

#[test]
fn only_claude_and_codex_have_a_distribution() {
    assert_eq!(codex().npm_package, "@openai/codex");
    assert_eq!(claude().npm_package, "@anthropic-ai/claude-code");
    assert!(distribution("gemini").is_none());
    assert!(distribution("mock-cli").is_none());
}

#[test]
fn homebrew_cask_upgrades_with_the_prefix_brew() {
    let plan = plan(
        &codex(),
        &loc(
            "/opt/homebrew/bin/codex",
            "/opt/homebrew/Caskroom/codex/0.155.1/bin/codex",
        ),
        &|p| p == "/opt/homebrew/bin/brew",
    );
    assert_eq!(plan.method, CliInstallMethod::Homebrew);
    assert_eq!(
        plan.latest,
        LatestSource::BrewCask {
            token: "codex".into()
        }
    );
    assert_eq!(plan.command.program, "/opt/homebrew/bin/brew");
    assert_eq!(args(&plan.command), ["upgrade", "--cask", "codex"]);
    assert!(plan.can_update);
    assert_eq!(
        plan.command.display(),
        "/opt/homebrew/bin/brew upgrade --cask codex"
    );
}

#[test]
fn homebrew_formula_falls_back_to_bare_brew() {
    let plan = plan(
        &codex(),
        &loc(
            "/usr/local/bin/codex",
            "/usr/local/Cellar/codex/0.160.0/bin/codex",
        ),
        &|_| false,
    );
    assert_eq!(
        plan.latest,
        LatestSource::BrewFormula {
            name: "codex".into()
        }
    );
    assert_eq!(plan.command.program, "brew");
    assert_eq!(args(&plan.command), ["upgrade", "codex"]);
}

#[test]
fn a_node_package_inside_a_brew_formula_is_still_homebrew() {
    let plan = plan(
        &claude(),
        &loc(
            "/opt/homebrew/bin/claude",
            "/opt/homebrew/Cellar/claude-code/2.1.0/libexec/lib/node_modules/@anthropic-ai/claude-code/cli.js",
        ),
        &|_| true,
    );
    assert_eq!(plan.method, CliInstallMethod::Homebrew);
    assert_eq!(args(&plan.command), ["upgrade", "claude-code"]);
}

#[test]
fn npm_global_uses_the_sibling_npm_of_the_bin_link() {
    let plan = plan(
        &codex(),
        &loc(
            "/Users/me/.nvm/versions/node/v24.13.1/bin/codex",
            "/Users/me/.nvm/versions/node/v24.13.1/lib/node_modules/@openai/codex/bin/codex.js",
        ),
        &|p| p == "/Users/me/.nvm/versions/node/v24.13.1/bin/npm",
    );
    assert_eq!(plan.method, CliInstallMethod::Npm);
    assert_eq!(
        plan.latest,
        LatestSource::Npm {
            package: "@openai/codex".into()
        }
    );
    assert_eq!(
        plan.command.program,
        "/Users/me/.nvm/versions/node/v24.13.1/bin/npm"
    );
    assert_eq!(
        args(&plan.command),
        ["install", "-g", "@openai/codex@latest"]
    );
}

#[test]
fn a_similarly_named_package_is_not_the_cli() {
    let plan = plan(
        &codex(),
        &loc(
            "/usr/local/bin/codex",
            "/usr/local/lib/node_modules/@openai/codex-sdk/bin/codex.js",
        ),
        &|_| true,
    );
    assert_eq!(plan.method, CliInstallMethod::Unknown);
}

#[test]
fn pnpm_and_bun_globals_use_their_own_manager() {
    let pnpm = plan(
        &claude(),
        &loc(
            "/Users/me/Library/pnpm/claude",
            "/Users/me/Library/pnpm/global/5/node_modules/@anthropic-ai/claude-code/cli.js",
        ),
        &|_| true,
    );
    assert_eq!(pnpm.method, CliInstallMethod::Pnpm);
    assert_eq!(
        pnpm.command.display(),
        "pnpm add -g @anthropic-ai/claude-code@latest"
    );

    let bun = plan(
        &claude(),
        &loc(
            "/Users/me/.bun/bin/claude",
            "/Users/me/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js",
        ),
        &|_| true,
    );
    assert_eq!(bun.method, CliInstallMethod::Bun);
    assert_eq!(
        bun.command.display(),
        "bun add -g @anthropic-ai/claude-code@latest"
    );
}

#[test]
fn claude_native_install_updates_itself_through_the_launcher() {
    let plan = plan(
        &claude(),
        &loc(
            "/Users/me/.local/bin/claude",
            "/Users/me/.local/share/claude/versions/2.1.280",
        ),
        &|_| false,
    );
    assert_eq!(plan.method, CliInstallMethod::Native);
    assert_eq!(plan.latest, LatestSource::ClaudeNative);
    assert_eq!(plan.command.display(), "/Users/me/.local/bin/claude update");
    assert!(plan.can_update);
}

#[test]
fn codex_has_no_native_installer() {
    let plan = plan(
        &codex(),
        &loc(
            "/Users/me/.local/bin/codex",
            "/Users/me/.local/share/claude/versions/0.1.0",
        ),
        &|_| true,
    );
    assert_eq!(plan.method, CliInstallMethod::Unknown);
}

#[test]
fn unknown_install_suggests_npm_but_never_runs_it() {
    let plan = plan(
        &claude(),
        &loc("/opt/tools/claude", "/opt/tools/claude"),
        &|_| true,
    );
    assert_eq!(plan.method, CliInstallMethod::Unknown);
    assert!(!plan.can_update);
    assert_eq!(
        plan.command.display(),
        "npm install -g @anthropic-ai/claude-code@latest"
    );
    assert_eq!(
        plan.latest,
        LatestSource::Npm {
            package: "@anthropic-ai/claude-code".into()
        }
    );
}

#[test]
fn display_quotes_arguments_with_spaces() {
    let plan = plan(
        &claude(),
        &loc(
            "/Users/me/My Tools/bin/claude",
            "/Users/me/.local/share/claude/versions/2.1.280",
        ),
        &|_| false,
    );
    assert_eq!(
        plan.command.display(),
        "'/Users/me/My Tools/bin/claude' update"
    );
}
