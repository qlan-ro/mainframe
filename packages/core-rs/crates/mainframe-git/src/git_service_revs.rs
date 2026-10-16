//! Revision queries: merge bases, the base branch, and commits by date.

use super::*;

impl<E: GitExec> GitService<E> {
    /// The newest commit on HEAD made before `when` (any date git parses, e.g.
    /// ISO 8601); `None` when HEAD has no commit that old.
    pub async fn last_commit_before(&self, when: &str) -> Result<Option<String>, GitServiceError> {
        let out = self
            .git(
                argv!["rev-list", "-1", format!("--before={when}"), "HEAD"],
                None,
            )
            .await?;
        let sha = out.trim();
        Ok((!sha.is_empty()).then(|| sha.to_string()))
    }

    pub async fn merge_base(
        &self,
        branch1: &str,
        branch2: &str,
    ) -> Result<Option<String>, GitServiceError> {
        match self.git(argv!["merge-base", branch1, branch2], None).await {
            Ok(out) => Ok(Some(out.trim().to_string())),
            // expected — branches may share no common ancestor
            Err(_) => Ok(None),
        }
    }

    /// Tries 'main' then 'master' to find a common merge-base with HEAD.
    pub async fn detect_base_branch(&self) -> Result<Option<DetectedBaseBranch>, GitServiceError> {
        for base in ["main", "master"] {
            if let Some(sha) = self.merge_base(base, "HEAD").await? {
                return Ok(Some(DetectedBaseBranch {
                    base_branch: base.to_string(),
                    merge_base: sha,
                }));
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
#[path = "git_service_revs_tests.rs"]
mod tests;
