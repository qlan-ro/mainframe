use std::future::{Future, poll_fn};
use std::task::Poll;

use super::*;

async fn assert_pending(future: std::pin::Pin<&mut impl Future>) {
    let mut future = future;
    poll_fn(|cx| {
        assert!(future.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
}

async fn cancelled_publication_finishes_before_newer_state(newest: &'static [u8]) {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("credentials.json");
    let ordering = ordering::for_path(&path).await.unwrap();
    let first_path = path.clone();
    let first_ordering = ordering;
    let (paused, reached) = tokio::sync::oneshot::channel();
    let (release, resumed) = std::sync::mpsc::channel();
    let first = tokio::spawn(async move {
        write_ordered(
            &first_path,
            br#"{"label":"old"}"#,
            true,
            first_ordering,
            move || {
                paused.send(()).unwrap();
                resumed.recv().unwrap();
            },
        )
        .await
    });
    reached.await.unwrap();
    first.abort();
    assert!(first.await.unwrap_err().is_cancelled());
    let ordering = ordering::for_path(&path).await.unwrap();
    assert!(ordering.try_lock().is_err());
    let mut newer = std::pin::pin!(write_ordered(&path, newest, true, ordering, || {}));
    assert_pending(newer.as_mut()).await;
    assert!(!path.exists());
    release.send(()).unwrap();
    newer.await.unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), newest);
    assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn cancelled_write_cannot_overwrite_newer_credentials() {
    cancelled_publication_finishes_before_newer_state(br#"{"label":"new"}"#).await;
}

#[tokio::test]
async fn cancelled_write_cannot_restore_deleted_credentials() {
    cancelled_publication_finishes_before_newer_state(b"{}").await;
}

#[tokio::test]
async fn cancellation_before_acquisition_does_not_publish_or_block_later_writes() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("data");
    let ordering = ordering::for_path(&path).await.unwrap();
    let guard = ordering.clone().lock_owned().await;
    {
        let mut cancelled = std::pin::pin!(write_ordered(
            &path,
            b"cancelled",
            false,
            ordering.clone(),
            || panic!("cancelled writer ran")
        ));
        assert_pending(cancelled.as_mut()).await;
    }
    drop(guard);
    write_atomic(&path, b"newest", false).await.unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"newest");
}

#[tokio::test]
async fn independent_destinations_do_not_wait_and_idle_keys_are_pruned() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("first");
    let ordering = ordering::for_path(&path).await.unwrap();
    let weak = Arc::downgrade(&ordering);
    let guard = ordering.lock_owned().await;
    write_atomic(&tmp.path().join("second"), b"independent", false)
        .await
        .unwrap();
    drop(guard);
    assert!(weak.upgrade().is_none());
    let _next = ordering::for_path(&tmp.path().join("third")).await.unwrap();
    let key = std::fs::canonicalize(tmp.path()).unwrap().join("first");
    assert!(!ordering::WRITERS.lock().await.contains_key(&key));
}

#[cfg(unix)]
#[tokio::test]
async fn directory_aliases_share_ordering_but_leaf_symlinks_are_replaced() {
    let tmp = tempfile::tempdir().unwrap();
    let directory = tmp.path().join("real");
    std::fs::create_dir(&directory).unwrap();
    let alias = tmp.path().join("alias");
    std::os::unix::fs::symlink(&directory, &alias).unwrap();
    let path = directory.join("data");
    let ordering = ordering::for_path(&path).await.unwrap();
    let alias_ordering = ordering::for_path(&alias.join("./data")).await.unwrap();
    assert!(Arc::ptr_eq(&ordering, &alias_ordering));
    let target = directory.join("target");
    std::fs::write(&target, b"untouched").unwrap();
    std::os::unix::fs::symlink(&target, &path).unwrap();
    let target_ordering = ordering::for_path(&target).await.unwrap();
    assert!(!Arc::ptr_eq(&ordering, &target_ordering));
    write_atomic(&path, b"replacement", false).await.unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"untouched");
    assert_eq!(std::fs::read(&path).unwrap(), b"replacement");
    assert!(
        !std::fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_symlink()
    );
}
