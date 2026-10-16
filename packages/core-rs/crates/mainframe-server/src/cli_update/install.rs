//! Install-method detection: from where a provider CLI's executable really
//! lives, decide the upgrade command and the latest-version source. Pure —
//! the caller resolves paths and answers `is_file`.

use mainframe_types::cli_update::CliInstallMethod;

/// How a provider CLI is published. Only adapters listed in [`distribution`]
/// get version checks and in-app updates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Distribution {
    pub npm_package: &'static str,
    /// The CLI's own installer, when it has one.
    pub native: Option<NativeInstall>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeInstall {
    /// Where the installer keeps versions, relative to the home directory.
    pub versions_dir: &'static str,
    /// Arguments that make the CLI update itself.
    pub update_args: &'static [&'static str],
}

pub fn distribution(adapter_id: &str) -> Option<Distribution> {
    match adapter_id {
        "claude" => Some(Distribution {
            npm_package: "@anthropic-ai/claude-code",
            native: Some(NativeInstall {
                versions_dir: ".local/share/claude/versions",
                update_args: &["update"],
            }),
        }),
        "codex" => Some(Distribution {
            npm_package: "@openai/codex",
            native: None,
        }),
        _ => None,
    }
}

/// Where the latest version for an install's channel is published.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LatestSource {
    Npm {
        package: String,
    },
    BrewCask {
        token: String,
    },
    BrewFormula {
        name: String,
    },
    /// Claude Code's release channel (`latest` or `stable`).
    ClaudeNative,
}

/// A program and its arguments, run without a shell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
}

impl CommandSpec {
    fn new(program: impl Into<String>, args: &[&str]) -> Self {
        Self {
            program: program.into(),
            args: args.iter().map(|arg| (*arg).to_string()).collect(),
        }
    }

    /// Shell-like spelling for display; arguments with spaces are quoted.
    pub fn display(&self) -> String {
        std::iter::once(&self.program)
            .chain(&self.args)
            .map(|part| {
                if part.contains(' ') {
                    format!("'{part}'")
                } else {
                    part.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// The resolved executable: `path` as found (often a symlink), `canonical`
/// with every link followed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    pub path: String,
    pub canonical: String,
    pub home: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallPlan {
    pub method: CliInstallMethod,
    pub latest: LatestSource,
    pub command: CommandSpec,
    /// `false` means `command` is only a suggestion to run by hand.
    pub can_update: bool,
}

pub fn plan(dist: &Distribution, loc: &Located, is_file: &dyn Fn(&str) -> bool) -> InstallPlan {
    let npm_spec = format!("{}@latest", dist.npm_package);
    homebrew_plan(&loc.canonical, is_file)
        .or_else(|| node_plan(dist, loc, &npm_spec, is_file))
        .or_else(|| native_plan(dist, loc))
        .unwrap_or_else(|| InstallPlan {
            method: CliInstallMethod::Unknown,
            latest: LatestSource::Npm {
                package: dist.npm_package.to_string(),
            },
            command: CommandSpec::new("npm", &["install", "-g", &npm_spec]),
            can_update: false,
        })
}

/// Checked first: a Node CLI packaged as a formula still lives in `Cellar`.
fn homebrew_plan(canonical: &str, is_file: &dyn Fn(&str) -> bool) -> Option<InstallPlan> {
    if let Some((prefix, token)) = split_at_segment(canonical, "/Caskroom/") {
        return Some(InstallPlan {
            method: CliInstallMethod::Homebrew,
            latest: LatestSource::BrewCask {
                token: token.to_string(),
            },
            command: CommandSpec::new(brew(prefix, is_file), &["upgrade", "--cask", token]),
            can_update: true,
        });
    }
    let (prefix, name) = split_at_segment(canonical, "/Cellar/")?;
    Some(InstallPlan {
        method: CliInstallMethod::Homebrew,
        latest: LatestSource::BrewFormula {
            name: name.to_string(),
        },
        command: CommandSpec::new(brew(prefix, is_file), &["upgrade", name]),
        can_update: true,
    })
}

fn node_plan(
    dist: &Distribution,
    loc: &Located,
    npm_spec: &str,
    is_file: &dyn Fn(&str) -> bool,
) -> Option<InstallPlan> {
    let canonical = loc.canonical.as_str();
    if !canonical.contains(&format!("/node_modules/{}/", dist.npm_package)) {
        return None;
    }
    let (method, command) = if canonical.contains("/pnpm/") {
        (
            CliInstallMethod::Pnpm,
            CommandSpec::new("pnpm", &["add", "-g", npm_spec]),
        )
    } else if canonical.contains("/.bun/") {
        (
            CliInstallMethod::Bun,
            CommandSpec::new("bun", &["add", "-g", npm_spec]),
        )
    } else {
        (
            CliInstallMethod::Npm,
            CommandSpec::new(
                sibling_npm(&loc.path, is_file),
                &["install", "-g", npm_spec],
            ),
        )
    };
    Some(InstallPlan {
        method,
        latest: LatestSource::Npm {
            package: dist.npm_package.to_string(),
        },
        command,
        can_update: true,
    })
}

fn native_plan(dist: &Distribution, loc: &Located) -> Option<InstallPlan> {
    let native = dist.native?;
    let home = loc.home.as_deref()?;
    let versions = format!("{}/{}/", home.trim_end_matches('/'), native.versions_dir);
    loc.canonical.starts_with(&versions).then(|| InstallPlan {
        method: CliInstallMethod::Native,
        latest: LatestSource::ClaudeNative,
        command: CommandSpec::new(loc.path.clone(), native.update_args),
        can_update: true,
    })
}

/// `(prefix, name)` around `/Caskroom/<name>/` or `/Cellar/<name>/`.
fn split_at_segment<'a>(path: &'a str, segment: &str) -> Option<(&'a str, &'a str)> {
    let at = path.find(segment)?;
    let rest = &path[at + segment.len()..];
    let name = rest.split('/').next().filter(|name| !name.is_empty())?;
    Some((&path[..at], name))
}

/// The prefix's own `brew`, so an Intel and an Apple-silicon install never
/// cross; bare `brew` on `PATH` otherwise.
fn brew(prefix: &str, is_file: &dyn Fn(&str) -> bool) -> String {
    let candidate = format!("{prefix}/bin/brew");
    if is_file(&candidate) {
        candidate
    } else {
        "brew".to_string()
    }
}

/// The `npm` next to the CLI's own bin link (the same Node install, e.g. an
/// nvm version), bare `npm` otherwise.
fn sibling_npm(path: &str, is_file: &dyn Fn(&str) -> bool) -> String {
    let candidate = std::path::Path::new(path)
        .parent()
        .map(|dir| dir.join("npm").to_string_lossy().into_owned());
    match candidate {
        Some(candidate) if is_file(&candidate) => candidate,
        _ => "npm".to_string(),
    }
}

#[cfg(test)]
#[path = "install_tests.rs"]
mod tests;
