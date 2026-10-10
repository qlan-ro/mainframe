use std::path::MAIN_SEPARATOR;

pub fn is_uuid(value: &str) -> bool {
    let groups = [8, 4, 4, 4, 12];
    let mut parts = value.split('-');
    groups.into_iter().all(|len| {
        parts.next().is_some_and(|part| {
            part.len() == len && part.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
    }) && parts.next().is_none()
}

pub fn cwd_belongs_to_project(cwd: Option<&str>, project: &str) -> bool {
    let Some(cwd) = cwd else {
        return false;
    };
    cwd == project || cwd.starts_with(&format!("{project}{MAIN_SEPARATOR}"))
}

pub fn encode_claude_project_path(path: &str) -> String {
    path.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_and_project_boundary_and_claude_layout() {
        assert!(is_uuid("12345678-1234-ABCD-1234-123456789abc"));
        assert!(!is_uuid("12345678-1234-ABCD-1234-123456789abz"));
        assert!(cwd_belongs_to_project(Some("/a/project/sub"), "/a/project"));
        assert!(!cwd_belongs_to_project(
            Some("/a/project-other"),
            "/a/project"
        ));
        assert!(cwd_belongs_to_project(Some(""), ""));
        assert_eq!(
            encode_claude_project_path("/a/my project.v2"),
            "-a-my-project-v2"
        );
    }
}
