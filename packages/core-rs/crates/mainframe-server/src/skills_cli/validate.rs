//! Input validation for skills-CLI sources and skill names. Rejections never
//! reach the CLI runner — every entry point in `mod.rs` validates before
//! resolving a binary or spawning anything.

const ALLOWED_HOSTS: &[&str] = &[
    "github.com",
    "www.github.com",
    "gitlab.com",
    "www.gitlab.com",
];

pub fn validate_source(source: &str) -> Result<(), String> {
    let trimmed = source.trim();
    let looks_local = trimmed.starts_with('/')
        || trimmed.starts_with("./")
        || trimmed.starts_with("../")
        || trimmed.starts_with('~')
        || trimmed.starts_with("file:")
        || trimmed.starts_with("git+file:");
    let rejected = trimmed.is_empty()
        || trimmed.starts_with('-')
        || looks_local
        || trimmed.contains(char::is_whitespace);
    if rejected
        || !(is_owner_repo_shorthand(trimmed)
            || is_allowed_https(trimmed)
            || is_allowed_ssh(trimmed))
    {
        return Err(
            "Source must be an owner/repo shorthand, an allow-listed github.com/gitlab.com URL, or an SSH remote"
                .to_string(),
        );
    }
    Ok(())
}

fn is_owner_repo_shorthand(source: &str) -> bool {
    if source.is_empty() || source.contains("://") || source.contains('@') {
        return false;
    }
    let parts: Vec<&str> = source.split('/').collect();
    parts.len() >= 2 && parts.iter().all(|p| !p.is_empty())
}

fn is_allowed_https(source: &str) -> bool {
    let Some(rest) = source.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or("");
    ALLOWED_HOSTS.contains(&host)
}

fn is_allowed_ssh(source: &str) -> bool {
    let Some(rest) = source.strip_prefix("git@") else {
        return false;
    };
    let Some((host, path)) = rest.split_once(':') else {
        return false;
    };
    if !ALLOWED_HOSTS.contains(&host) {
        return false;
    }
    let path = path.strip_suffix(".git").unwrap_or(path);
    let parts: Vec<&str> = path.split('/').collect();
    parts.len() == 2 && parts.iter().all(|p| !p.is_empty())
}

pub fn validate_skill_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Skill name must not be empty".to_string());
    }
    if name.starts_with('-') {
        return Err("Skill name must not start with a dash".to_string());
    }
    if name.chars().any(char::is_control) {
        return Err("Skill name must not contain control characters".to_string());
    }
    Ok(())
}
