use super::*;
use axum::http::HeaderName;

const POLICY: &str = "sandbox allow-scripts; default-src 'none'";
const PICKER: &str = "<script src=\"/picker.js\"></script>";

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = std::fs::canonicalize(dir.path())
        .expect("canonical")
        .join("cache/slug/1");
    std::fs::create_dir_all(root.join("project/slides")).expect("mkdir");
    Fixture { _dir: dir, root }
}

impl Fixture {
    fn preview(&self) -> Preview<'_> {
        Preview {
            root: &self.root,
            policy: POLICY,
            picker: PICKER,
        }
    }

    fn write(&self, relative: &str, content: &str) {
        std::fs::write(self.root.join(relative), content).expect("write");
    }
}

fn header_of(response: &Response, name: HeaderName) -> String {
    response.headers()[name]
        .to_str()
        .expect("ascii header")
        .to_string()
}

async fn body(response: Response) -> String {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    String::from_utf8(bytes.to_vec()).expect("utf8")
}

#[test]
fn only_claude_ai_artifact_urls_are_accepted() {
    assert_eq!(
        slug_of("https://claude.ai/artifact/V1LAdj_r-X"),
        Some("V1LAdj_r-X")
    );
    assert_eq!(slug_of("https://claude.ai/artifact/"), None);
    assert_eq!(slug_of("https://claude.ai/artifact/a/../b"), None);
    assert_eq!(slug_of("https://claude.ai/artifact/a?x=1"), None);
    assert_eq!(slug_of("https://claude.ai.evil.example/artifact/a"), None);
}

#[test]
fn a_page_may_only_reach_its_own_version() {
    let policy = sandbox_policy("abc", "179-0618");
    assert!(policy.starts_with("sandbox allow-scripts;"));
    assert!(policy.contains("connect-src http://127.0.0.1:*/api/artifact-preview/abc/179-0618/ "));
    assert!(!policy.contains("allow-same-origin"));
}

#[tokio::test]
async fn traversal_and_internal_files_are_not_served() {
    let fx = fixture();
    fx.write(".preview.json", "{}");
    std::fs::write(
        fx.root.parent().expect("parent").join("secret.html"),
        "secret",
    )
    .expect("write");

    assert!(read_inside(&fx.root, ".preview.json").await.is_none());
    assert!(read_inside(&fx.root, "../secret.html").await.is_none());
    assert!(read_inside(&fx.root, "/etc/passwd").await.is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn a_symlink_cannot_leave_the_version() {
    let fx = fixture();
    let secret = fx.root.parent().expect("parent").join("secret.html");
    std::fs::write(&secret, "secret").expect("write");
    std::os::unix::fs::symlink(&secret, fx.root.join("link.html")).expect("link");

    assert!(read_inside(&fx.root, "link.html").await.is_none());
}

#[tokio::test]
async fn every_response_carries_the_sandbox() {
    let fx = fixture();
    fx.write("page.html", "<h1>hi</h1>");

    for response in [
        fx.preview().file("page.html").await,
        fx.preview().file("gone.html").await,
    ] {
        assert_eq!(
            header_of(&response, header::CONTENT_SECURITY_POLICY),
            POLICY
        );
    }
}

#[tokio::test]
async fn support_js_serves_the_real_runtime_for_any_board_depth() {
    let fx = fixture();
    std::fs::create_dir_all(fx.root.join("artifact-type")).expect("mkdir");
    fx.write(cache::RUNTIME_FILE, "// runtime");

    assert_eq!(
        body(fx.preview().file("project/support.js").await).await,
        "// runtime"
    );
    assert_eq!(
        body(fx.preview().file("project/sub/support.js").await).await,
        "// runtime"
    );
}

#[test]
fn the_picker_runs_before_a_pages_own_scripts() {
    assert_eq!(
        with_picker(
            "<!doctype html><HEAD lang=\"en\"><script>a</script></HEAD>",
            "<p>"
        ),
        "<!doctype html><HEAD lang=\"en\"><p><script>a</script></HEAD>"
    );
}

#[test]
fn a_page_with_no_head_still_gets_the_picker() {
    assert_eq!(with_picker("<h1>hi</h1>", "<p>"), "<h1>hi</h1><p>");
}

#[tokio::test]
async fn every_html_page_carries_the_picker_and_other_files_do_not() {
    let fx = fixture();
    fx.write("project/Main.dc.html", "<html><head></head></html>");
    fx.write("project/style.css", "body{}");

    assert!(
        body(fx.preview().file("project/Main.dc.html").await)
            .await
            .contains(PICKER)
    );
    assert!(
        !body(fx.preview().file("project/style.css").await)
            .await
            .contains(PICKER)
    );
}

#[tokio::test]
async fn an_unknown_file_type_is_not_served() {
    let fx = fixture();
    fx.write("notes.txt", "text");
    assert_eq!(
        fx.preview().file("notes.txt").await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn a_design_index_lists_its_boards_in_order() {
    let fx = fixture();
    fx.write(
        CANVAS_INDEX,
        r#"{"title":"A <b>","order":["Two.dc.html","One.dc.html"],"boards":{
        "One.dc.html":{"w":100,"h":50,"title":"First"},"Two.dc.html":{"w":200,"h":60,"title":"Second"}}}"#,
    );

    let page = body(fx.preview().index().await).await;
    assert!(page.contains("A &lt;b&gt;"));
    assert!(
        page.find("project/Two.dc.html").expect("two")
            < page.find("project/One.dc.html").expect("one")
    );
    assert!(page.contains(r#"data-w="200" data-h="60""#));
}

#[tokio::test]
async fn a_slide_gets_the_deck_fonts_and_hides_speaker_notes() {
    let fx = fixture();
    fx.write(
        DECK_INDEX,
        r#"{"order":["cover"],"faces":{"f":{"family":"F","href":"https://fonts.googleapis.com/x"}}}"#,
    );
    fx.write(
        "project/slides/cover.html",
        "<section id=\"cover\"></section>",
    );

    assert!(
        body(fx.preview().index().await)
            .await
            .contains("slide/cover")
    );
    let page = body(fx.preview().slide("cover").await).await;
    assert!(page.contains(r#"href="https://fonts.googleapis.com/x""#));
    assert!(page.contains("aside{display:none}"));
    assert!(page.contains(r#"<section id="cover">"#));
}

#[tokio::test]
async fn an_untyped_artifact_serves_its_own_page() {
    let fx = fixture();
    fx.write("index.html", "<h1>plain</h1>");

    assert!(
        body(fx.preview().index().await)
            .await
            .starts_with("<h1>plain</h1>")
    );
}
