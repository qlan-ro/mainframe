import json,re,math,html,sys,os
sys.path.insert(0,os.path.dirname(__file__))
from states import BOARDS
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','lib'))
from boards import write_board
HERE=os.path.dirname(os.path.abspath(__file__))
ROOT=os.path.dirname(HERE)  # design/canvas
PROTO=os.path.join(ROOT,'..','redesign','prototype','index.html')
FR=json.load(open(os.path.join(HERE,'frags.json')))
src=open(PROTO).read()
css=src[src.index('<style>')+7:src.index('</style>')]
# scope the prototype's page-level rules to each frame (.pf) so light and dark frames can sit side by side
css=css.replace(':root[data-theme=dark]','.pf[data-theme=dark]').replace(':root{','.pf{').replace('html{scrollbar-color','.pf{scrollbar-color')
css=css.replace('html,body{height:100%}','').replace('body{background','.pf{background')
css=css.replace('{{','{ {')
FRAME_CSS='''
.pf .stage{height:var(--fh)!important;display:block}
.pf .win{width:var(--fw)!important;height:var(--fh)!important}
.pfx{position:absolute;overflow:hidden;border-radius:10px;box-shadow:0 0 0 1px rgba(0,0,0,.12),0 6px 24px rgba(0,0,0,.08);background:#fff}
.pf{position:absolute;transform:translateZ(0);overflow:hidden}
.cap{position:absolute;font:12.5px/18px -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;color:#3a3a3c}
.cap b{color:#1f1f1f;font-weight:600}
.bh{position:absolute;left:48px;top:36px;font:600 22px/28px -apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;color:#1f1f1f;letter-spacing:-.01em}
.bnote{position:absolute;left:48px;top:92px;max-width:1400px;font:13px/18px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#1f1f1f;background:#fff4d6;border-radius:8px;padding:6px 10px}
.bs{position:absolute;left:48px;top:68px;font:13px/18px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#5c5c61}
'''
SPRITE=FR['__sprite']['html']
def md_inline(t):
    t=html.escape(t,quote=False)
    t=re.sub(r'\*\*(.+?)\*\*',r'<b>\1</b>',t)
    t=re.sub(r'`([^`]+)`',r'<code style="font:12px ui-monospace,SF Mono,Menlo,monospace;background:rgba(0,0,0,.06);border-radius:4px;padding:0 4px">\1</code>',t)
    return t.replace('{{','{​{')
def page(title,body,w,h,props=None):
    p={"$preview":{"width":w,"height":h}}
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{html.escape(title)}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{{margin:0}}
{body[0]}
</style>
</helmet>
{body[1]}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{json.dumps(p,separators=(",",":"))}'>
class Component extends DCLogic {{
  renderVals() {{ return {{}}; }}
}}
</script>
</body>
</html>
'''
def caplines(text,w): return max(1,math.ceil(len(re.sub(r'\*\*','',text))/max(20,(w/6.7))))
def board(b):
    pad,gap,rowgap,head=48,48,44,(150 if b.get('note') else 112)
    cols=b['cols']
    items=[]
    for s in b['states']:
        fr=FR[s['id']];W=fr['w'];H=fr['h']
        x,y,cw,ch=(0,0,W,H) if s['crop'] is None else s['crop']
        capw=max(cw,300); caph=caplines(s['cap'],capw)*18+10
        items.append((s,fr,x,y,cw,ch,caph))
    # pack rows of `cols`
    out=[];cy=head;maxw=0
    for i in range(0,len(items),cols):
        row=items[i:i+cols];cx=pad;rowh=0
        for (s,fr,x,y,cw,ch,caph) in row:
            out.append((s,fr,x,y,cw,ch,caph,cx,cy))
            cx+=cw+gap;rowh=max(rowh,caph+ch)
        maxw=max(maxw,cx-gap+pad);cy+=rowh+rowgap
    BW=max(maxw,900);BH=cy-rowgap+pad
    parts=[f'<div style="position:relative;width:{BW}px;height:{BH}px;background:#f3f3f5">',
           f'<div style="position:absolute;width:0;height:0;overflow:hidden">{SPRITE}</div>',
           f'<div class="bh">{html.escape(b["title"])}</div>',
           f'<div class="bs">Rendered from the final prototype (prototype/index.html, 24 Nov 2026). Decision numbers refer to the spec board on the left.</div>']
    if b.get('note'): parts.append(f'<div class="bnote">{md_inline(b["note"])}</div>')
    for (s,fr,x,y,cw,ch,caph,cx,cy) in out:
        capw=max(cw,300)
        parts.append(f'<div class="cap" style="left:{cx}px;top:{cy}px;width:{capw}px">{md_inline(s["cap"])}</div>')
        frag=fr['html'].replace('{{','{​{')
        parts.append(f'<div class="pfx" style="left:{cx}px;top:{cy+caph}px;width:{cw}px;height:{ch}px"><div class="pf" data-theme="{s["theme"]}" style="--fw:{fr["w"]}px;--fh:{fr["h"]}px;left:{-x}px;top:{-y}px;width:{fr["w"]}px;height:{fr["h"]}px">{frag}</div></div>')
    parts.append('</div>')
    return page(b['title'],(css+FRAME_CSS,'\n'.join(parts)),BW,BH),BW,BH
def spec():
    md=open(os.path.join(ROOT,'..','redesign','DECISIONS.md')).read().split('\n')
    o=[];i=0
    while i<len(md):
        l=md[i]
        if l.startswith('|'):
            rows=[]
            while i<len(md) and md[i].startswith('|'):
                if not re.match(r'^\|[-| ]+\|$',md[i]): rows.append([c.strip() for c in md[i].strip('|').split('|')])
                i+=1
            th=rows[0];o.append('<table style="width:100%;border-collapse:collapse;margin:8px 0 20px;font-size:13px;line-height:19px">')
            o.append('<tr>'+''.join(f'<th style="text-align:left;font-weight:600;color:#5c5c61;padding:6px 10px;border-bottom:1px solid #d5d5da;{"width:44px" if j==0 else ("width:46%" if j==1 else "")}">{md_inline(c)}</th>' for j,c in enumerate(th))+'</tr>')
            for r in rows[1:]: o.append('<tr>'+''.join(f'<td style="vertical-align:top;padding:7px 10px;border-bottom:1px solid #e6e6ea;{"font-weight:600;white-space:nowrap" if j==0 else ""}">{md_inline(c)}</td>' for j,c in enumerate(r))+'</tr>')
            o.append('</table>');continue
        if l.startswith('# '): o.append(f'<h1 style="font-size:26px;line-height:32px;margin:0 0 12px;letter-spacing:-.01em">{md_inline(l[2:])}</h1>')
        elif l.startswith('## '): o.append(f'<h2 style="font-size:18px;line-height:24px;margin:28px 0 6px">{md_inline(l[3:])}</h2>')
        elif l.startswith('### '): o.append(f'<h3 style="font-size:15px;line-height:20px;margin:20px 0 4px">{md_inline(l[4:])}</h3>')
        elif l.startswith('- '): o.append(f'<div style="display:flex;gap:8px;margin:3px 0"><span>•</span><span>{md_inline(l[2:])}</span></div>')
        elif l.strip(): o.append(f'<p style="margin:6px 0">{md_inline(l)}</p>')
        i+=1
    body='<div style="width:1360px;box-sizing:border-box;padding:48px 56px;background:#fff;color:#1f1f1f;font:13.5px/20px -apple-system,BlinkMacSystemFont,\'SF Pro Text\',system-ui,sans-serif">'+'\n'.join(o)+'</div>'
    return body
if __name__=='__main__':
    outdir=os.path.join(ROOT,'project');os.makedirs(outdir,exist_ok=True)
    sizes={}
    for b in BOARDS:
        txt,w,h=board(b);write_board(b['file'],txt);sizes[b['file']]=(w,h,b['title'])
    sb=spec();write_board('Proposal-Redesign-Spec',page('Window redesign: decisions',('',sb),1360,4000))
    json.dump(sizes,open(os.path.join(HERE,'sizes.json'),'w'),indent=1)
    for k,v in sizes.items(): print(k,v[0],'x',v[1], round(os.path.getsize(os.path.join(outdir,k+'.dc.html'))/1e6,2),'MB')
