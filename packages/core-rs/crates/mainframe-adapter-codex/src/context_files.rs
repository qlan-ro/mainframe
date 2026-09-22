use std::path::{Path, PathBuf};

use mainframe_adapter_api::ContextFiles;
use mainframe_types::context::{ContextFile, ContextFileSource};

pub fn collect_codex_context_files(project_path: &str) -> ContextFiles {
    let home = std::env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")));
    collect(Path::new(project_path), home.as_deref())
}

fn instruction_file(dir: &Path, source: ContextFileSource) -> Option<ContextFile> {
    ["AGENTS.override.md", "AGENTS.md"]
        .into_iter()
        .find_map(|name| {
            let path = dir.join(name);
            let content = std::fs::read_to_string(&path).ok()?;
            if content.trim().is_empty() {
                return None;
            }
            Some(ContextFile {
                path: path.to_string_lossy().into_owned(),
                content,
                source,
            })
        })
}

fn collect(project: &Path, home: Option<&Path>) -> ContextFiles {
    let global = home
        .and_then(|home| instruction_file(home, ContextFileSource::Global))
        .into_iter()
        .collect();
    let root = project
        .ancestors()
        .find(|dir| dir.join(".git").exists())
        .unwrap_or(project);
    let mut dirs = Vec::new();
    for dir in project.ancestors() {
        dirs.push(dir);
        if dir == root {
            break;
        }
    }
    let project = dirs
        .into_iter()
        .rev()
        .filter_map(|dir| {
            let mut file = instruction_file(dir, ContextFileSource::Project)?;
            if let Ok(relative) = Path::new(&file.path).strip_prefix(project) {
                file.path = relative.to_string_lossy().into_owned();
            }
            Some(file)
        })
        .collect();
    ContextFiles { global, project }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_global_and_ancestor_instructions_with_override_precedence() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let repo = root.path().join("repo");
        let cwd = repo.join("sub");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&cwd).unwrap();
        std::fs::create_dir(repo.join(".git")).unwrap();
        for dir in [&home, &repo, &cwd] {
            std::fs::write(dir.join("AGENTS.md"), "base").unwrap();
            std::fs::write(dir.join("CLAUDE.md"), "not Codex").unwrap();
        }
        std::fs::write(home.join("AGENTS.override.md"), "global override").unwrap();
        std::fs::write(cwd.join("AGENTS.override.md"), "project override").unwrap();
        let files = collect(&cwd, Some(&home));
        assert_eq!(files.global.len(), 1);
        assert_eq!(files.global[0].content, "global override");
        assert_eq!(files.project.len(), 2);
        assert_eq!(files.project[0].content, "base");
        assert_eq!(files.project[1].path, "AGENTS.override.md");
    }
}
