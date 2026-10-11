#[tokio::test]
async fn merge_conflict_on_failure() {
    let (svc, _calls) = service(|_i, args| {
        if args[0] == "merge" {
            Err(gerr("CONFLICTS"))
        } else if args[0] == "diff" {
            Ok("src/index.ts\nsrc/app.ts\n".to_string())
        } else {
            Ok(String::new())
        }
    });
    let result = svc.merge("feat/foo").await.unwrap();
    match result {
        MergeResult::Conflict { conflicts, .. } => {
            assert!(conflicts.contains(&"src/index.ts".to_string()));
        }
        _ => panic!("expected conflict"),
    }
}

// ---- push() ----

#[tokio::test]
async fn push_success_with_matching_branch() {
    let (svc, calls) = service(|_i, args| {
        if args[0] == "branch" {
            Ok("* main\n".to_string())
        } else if args[0] == "rev-parse" {
            Ok("origin/main\n".to_string())
        } else {
            Ok(String::new())
        }
    });
    let result = svc.push(None, None).await.unwrap();
    assert!(matches!(result, PushResult::Success { .. }));
    let calls = calls.lock().unwrap();
    assert!(
        calls
            .iter()
            .any(|(a, o)| *a == owned(&["push", "origin", "main:main"]) && *o == no_timeout())
    );
}

#[tokio::test]
async fn push_uses_refspec_when_remote_branch_differs() {
    let (svc, calls) = service(|_i, args| {
        Ok(if args[0] == "rev-parse" {
            "origin/session/imhoQVRy\n".to_string()
        } else {
            String::new()
        })
    });
    let result = svc.push(Some("session/imhoQVRy-2"), None).await.unwrap();
    assert!(matches!(result, PushResult::Success { .. }));
    let calls = calls.lock().unwrap();
    assert!(calls.iter().any(|(a, o)| *a
        == owned(&["push", "origin", "session/imhoQVRy-2:session/imhoQVRy"])
        && *o == no_timeout()));
}

#[tokio::test]
async fn push_falls_back_to_local_name_without_upstream() {
    let (svc, calls) = service(|_i, args| {
        if args[0] == "branch" {
            Ok("* new-branch\n".to_string())
        } else if args[0] == "rev-parse" {
            Err(gerr("no upstream"))
        } else {
            Ok(String::new())
        }
    });
    let result = svc.push(None, None).await.unwrap();
    assert!(matches!(result, PushResult::Success { .. }));
    let calls = calls.lock().unwrap();
    assert!(calls.iter().any(
        |(a, o)| *a == owned(&["push", "origin", "new-branch:new-branch"]) && *o == no_timeout()
    ));
}

// ---- pull() ----

#[tokio::test]
async fn pull_uses_fetch_refspec_for_non_current_branch() {
    let rev = AtomicUsize::new(0);
    let (svc, calls) = service(move |_i, args| {
        if args[0] == "branch" {
            Ok("* main\n".to_string())
        } else if args[0] == "rev-parse" {
            Ok(if rev.fetch_add(1, Ordering::SeqCst) == 0 {
                "aaa\n".to_string()
            } else {
                "bbb\n".to_string()
            })
        } else {
            Ok(String::new())
        }
    });
    let result = svc
        .pull(Some("origin"), Some("feat/foo"), Some("feat/foo"))
        .await
        .unwrap();
    let calls = calls.lock().unwrap();
    assert!(calls.iter().any(
        |(a, o)| *a == owned(&["fetch", "origin", "feat/foo:feat/foo"]) && *o == no_timeout()
    ));
    assert!(matches!(result, PullResult::Success { .. }));
}

#[tokio::test]
async fn pull_up_to_date_when_non_current_ref_unchanged() {
    let (svc, _calls) = service(|_i, args| {
        if args[0] == "branch" {
            Ok("* main\n".to_string())
        } else if args[0] == "rev-parse" {
            Ok("aaa\n".to_string())
        } else {
            Ok(String::new())
        }
    });
    let result = svc
        .pull(Some("origin"), Some("feat/foo"), Some("feat/foo"))
        .await
        .unwrap();
    assert!(matches!(result, PullResult::UpToDate));
}

// ---- deleteBranch() ----

#[tokio::test]
async fn delete_branch_returns_success() {
    let (svc, _calls) =
        service(|_i, _args| Ok("Deleted branch feat/old (was abc123).\n".to_string()));
    let result = svc.delete_branch("feat/old", false, false).await.unwrap();
    assert!(matches!(result, DeleteBranchResult::Success));
}

// ---- abort() ----

#[tokio::test]
async fn abort_returns_false_when_no_merge_or_rebase() {
    let (svc, _calls) = service(|_i, _args| Ok("/fake/path/.git\n".to_string()));
    let result = svc.abort().await.unwrap();
    assert_eq!(result, AbortResult { aborted: false });
}

// ---- detectBaseBranch() ----

#[tokio::test]
async fn detect_base_branch_returns_main_when_merge_base_exists() {
    let (svc, calls) = service(|idx, _args| {
        if idx == 0 {
            Ok("abc123\n".to_string())
        } else {
            Ok(String::new())
        }
    });
    let result = svc.detect_base_branch().await.unwrap();
    assert_eq!(
        result,
        Some(DetectedBaseBranch {
            base_branch: "main".to_string(),
            merge_base: "abc123".to_string()
        })
    );
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert!(
        calls
            .iter()
            .any(|(a, o)| *a == owned(&["merge-base", "main", "HEAD"]) && o.is_none())
    );
}

#[tokio::test]
async fn detect_base_branch_falls_back_to_master() {
    let (svc, calls) = service(|idx, _args| {
        if idx == 0 {
            Err(gerr("no common ancestor"))
        } else {
            Ok("def456\n".to_string())
        }
    });
    let result = svc.detect_base_branch().await.unwrap();
    assert_eq!(
        result,
        Some(DetectedBaseBranch {
            base_branch: "master".to_string(),
            merge_base: "def456".to_string()
        })
    );
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].0, owned(&["merge-base", "main", "HEAD"]));
    assert_eq!(calls[1].0, owned(&["merge-base", "master", "HEAD"]));
}

#[tokio::test]
async fn detect_base_branch_returns_null_when_neither_resolves() {
    let (svc, _calls) = service(|_idx, _args| Err(gerr("no common ancestor")));
    let result = svc.detect_base_branch().await.unwrap();
    assert_eq!(result, None);
}

#[tokio::test]
async fn detect_base_branch_prefers_main() {
    let (svc, calls) = service(|idx, _args| {
        if idx == 0 {
            Ok("sha999\n".to_string())
        } else {
            Ok("sha111\n".to_string())
        }
    });
    let result = svc.detect_base_branch().await.unwrap();
    assert_eq!(
        result,
        Some(DetectedBaseBranch {
            base_branch: "main".to_string(),
            merge_base: "sha999".to_string()
        })
    );
    assert_eq!(calls.lock().unwrap().len(), 1);
}
