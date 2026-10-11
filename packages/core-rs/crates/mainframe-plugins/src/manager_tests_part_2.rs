#[tokio::test]
async fn notify_without_panel_does_not_track() {
    let (mgr, events) = manager();
    mgr.load_builtin(
        manifest(
            "noisy",
            vec![mainframe_types::plugin::PluginCapability::UiNotifications],
        ),
        PathBuf::new(),
        |ctx| async move {
            ctx.ui
                .notify(NotifyOptions {
                    title: "t".into(),
                    body: "b".into(),
                    level: None,
                })
                .await;
            Ok(Router::new())
        },
    )
    .await
    .unwrap();
    assert!(
        events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, DaemonEvent::PluginNotification { .. }))
    );
    let (_, body) = read(list_plugins(State(Arc::clone(&mgr.inner))).await).await;
    assert_eq!(body["plugins"][0]["panels"], json!([]));
}

#[tokio::test]
async fn github_port_is_threaded_from_manager_deps_into_the_plugin_context() {
    let (mgr, _e) = manager_with_github(Some(Arc::new(FakeGitHub)));
    let seen = Arc::new(Mutex::new(None));
    let out = Arc::clone(&seen);
    mgr.load_builtin(
        manifest("todos", vec![PluginCapability::HttpOutbound]),
        PathBuf::new(),
        move |ctx| {
            let out = Arc::clone(&out);
            async move {
                let repo = RepoRef {
                    owner: "qlan".to_string(),
                    repo: "mainframe".to_string(),
                };
                let issue = ctx.github.get_issue(&repo, 7, "github").await.unwrap();
                *out.lock().unwrap() = Some(issue.title);
                Ok(Router::new())
            }
        },
    )
    .await
    .unwrap();
    assert_eq!(seen.lock().unwrap().as_deref(), Some("fake"));
}

#[tokio::test]
async fn detail_404_for_unknown() {
    let (mgr, _e) = manager();
    let (status, body) =
        read(plugin_detail(State(Arc::clone(&mgr.inner)), Path("nope".into())).await).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({ "error": "Plugin not found" }));
}

#[tokio::test]
async fn router_mounts_listing_and_sub_routes() {
    let (mgr, _e) = manager();
    mgr.load_builtin(manifest("list-test", vec![]), PathBuf::new(), |_c| async {
        Ok(Router::new())
    })
    .await
    .unwrap();
    mgr.load_builtin(
        manifest("route-plugin", vec![]),
        PathBuf::new(),
        |_c| async {
            Ok(Router::new().route("/status", get(|| async { Json(json!({ "ok": true })) })))
        },
    )
    .await
    .unwrap();

    let app = mgr.router();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let base = format!("http://{addr}");

    let list: Value = reqwest::get(format!("{base}/"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(list["plugins"].as_array().unwrap().len(), 2);

    let sub: Value = reqwest::get(format!("{base}/route-plugin/status"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(sub["ok"], json!(true));

    let missing = reqwest::get(format!("{base}/does-not-exist"))
        .await
        .unwrap();
    assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);
}
