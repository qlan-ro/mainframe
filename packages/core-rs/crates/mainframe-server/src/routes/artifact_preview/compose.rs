//! Builds the pages a preview needs that aren't files: a design's canvas, a deck's
//! slide list, and one slide as a document.

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

/// The canvas page for a design's `canvas.json`: the index travels as inert JSON
/// and `canvas_script` lays it out, so no artifact text is parsed as markup here.
pub(super) fn design_index(canvas: &Value, canvas_script: &str) -> String {
    // `<` only appears inside JSON strings, where `\u003c` means the same thing,
    // so no value can end the data block early.
    let data = canvas.to_string().replace('<', "\\u003c");
    let title = escape_html(canvas["title"].as_str().unwrap_or("Design"));
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title></head><body><script type="application/json" id="mf-canvas-data">{data}</script><script src="{canvas_script}"></script></body></html>"#
    )
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

/// A migrated design: one page at a time, chosen at the top left. Each page draws
/// its own canvas, so it gets the whole view.
pub(super) fn pages_index(title: &str, pages: &[String]) -> String {
    let data = serde_json::to_string(pages)
        .unwrap_or_else(|_| "[]".to_string())
        .replace('<', "\\u003c");
    let title = escape_html(title);
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>{title}</title><style>{PAGES_STYLE}</style></head><body><label id="pages"><span>Page</span><select></select></label><iframe id="page" title="{title}"></iframe><script type="application/json" id="mf-pages-data">{data}</script><script>{PAGES_SCRIPT}</script></body></html>"#
    )
}

const PAGES_STYLE: &str = "html,body{margin:0;height:100%;overflow:hidden;font:13px system-ui,sans-serif}\
#page{position:fixed;inset:0;width:100%;height:100%;border:0}\
#pages{position:fixed;left:12px;top:12px;z-index:1;display:flex;gap:6px;align-items:center;padding:4px 4px 4px 10px;\
background:#fff;color:#7b766f;border:1px solid rgba(0,0,0,.12);border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.12)}\
#pages select{font:inherit;font-weight:600;color:#3d3a36;background:none;border:0;padding:4px 6px;cursor:pointer;max-width:260px}";

/// Names each page by its file, minus the folder and extension.
const PAGES_SCRIPT: &str = "const pages=JSON.parse(document.getElementById('mf-pages-data').textContent);\
const select=document.querySelector('#pages select'),frame=document.getElementById('page');\
for(const path of pages){const o=document.createElement('option');o.value=path;\
o.textContent=path.replace(/^project\\//,'').replace(/\\.html$/,'');select.appendChild(o)}\
const src=(path)=>path.split('/').map(encodeURIComponent).join('/');\
const show=(path)=>{frame.src=src(path)};select.addEventListener('change',()=>show(select.value));\
if(pages.length<2)document.getElementById('pages').style.display='none';if(pages[0])show(pages[0]);";

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
