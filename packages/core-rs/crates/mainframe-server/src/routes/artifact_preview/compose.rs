//! Builds the pages a preview needs that aren't files: a design's board gallery, a
//! deck's slide list, and one slide as a document.

use serde_json::Value;

const SLIDE_WIDTH: f64 = 1920.0;
const SLIDE_HEIGHT: f64 = 1080.0;

/// Scales each board down to the pane; boards keep their natural size otherwise.
const GALLERY_HEAD: &str = r#"<style>
html,body{margin:0;background:#ececea;color:#4a413a;font:12px system-ui,sans-serif}
main{display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px}
figure{margin:0}figcaption{padding-bottom:6px}
.board{overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2)}
iframe{display:block;border:0;transform-origin:0 0}
</style>"#;
const GALLERY_SCRIPT: &str = r#"<script>
function fit(){for(const b of document.querySelectorAll('.board')){
const w=+b.dataset.w,h=+b.dataset.h,s=Math.min(1,(innerWidth-48)/w),f=b.firstElementChild;
f.style.transform='scale('+s+')';b.style.width=w*s+'px';b.style.height=h*s+'px'}}
addEventListener('resize',fit);fit();
</script>"#;
const SLIDE_RESET: &str = "<style>*{margin:0;box-sizing:border-box}html,body{width:1920px;height:1080px;overflow:hidden}\
section{width:1920px;height:1080px;overflow:hidden}aside{display:none}</style>";

struct Frame {
    title: String,
    src: String,
    width: f64,
    height: f64,
}

pub(super) fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn order(index: &Value) -> Vec<&str> {
    index["order"]
        .as_array()
        .map(|names| names.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

fn gallery(title: &str, frames: &[Frame]) -> String {
    let boards: String = frames
        .iter()
        .map(|frame| {
            format!(
                r#"<figure><figcaption>{caption}</figcaption><div class="board" data-w="{w}" data-h="{h}"><iframe src="{src}" width="{w}" height="{h}" title="{caption}"></iframe></div></figure>"#,
                caption = escape_html(&frame.title),
                src = escape_html(&frame.src),
                w = frame.width,
                h = frame.height,
            )
        })
        .collect();
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>{}</title>{GALLERY_HEAD}</head><body><main>{boards}</main>{GALLERY_SCRIPT}</body></html>"#,
        escape_html(title),
    )
}

/// The gallery for a design's `canvas.json`.
pub(super) fn design_index(canvas: &Value) -> String {
    let frames: Vec<Frame> = order(canvas)
        .into_iter()
        .map(|name| {
            let board = &canvas["boards"][name];
            Frame {
                title: board["title"].as_str().unwrap_or(name).to_string(),
                src: format!("project/{name}"),
                width: board["w"].as_f64().unwrap_or(1280.0),
                height: board["h"].as_f64().unwrap_or(860.0),
            }
        })
        .collect();
    gallery(canvas["title"].as_str().unwrap_or("Design"), &frames)
}

/// The gallery for a deck's `deck.json`.
pub(super) fn deck_index(deck: &Value) -> String {
    let frames: Vec<Frame> = order(deck)
        .into_iter()
        .enumerate()
        .map(|(position, id)| Frame {
            title: format!("Slide {}", position + 1),
            src: format!("slide/{id}"),
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
        })
        .collect();
    gallery(deck["title"].as_str().unwrap_or("Slides"), &frames)
}

/// One slide fragment as a document, with the deck's fonts.
pub(super) fn slide_page(deck: &Value, fragment: &str) -> String {
    let fonts: String = deck["faces"]
        .as_object()
        .into_iter()
        .flat_map(|faces| faces.values())
        .filter_map(|face| face["href"].as_str())
        .map(|href| format!(r#"<link rel="stylesheet" href="{}">"#, escape_html(href)))
        .collect();
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8">{fonts}{SLIDE_RESET}</head><body>{fragment}</body></html>"#
    )
}
