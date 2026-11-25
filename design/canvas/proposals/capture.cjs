// node capture.cjs states.json out.json — renders each prototype state and serialises the window DOM for canvas boards
const {chromium}=require(require('path').resolve(__dirname,'../../../packages/e2e/node_modules/@playwright/test'));
const fs=require('fs');
const {numberIds}=require('./number-ids.cjs');
const PROTO='file://'+require('path').resolve(__dirname,'../../redesign/prototype/index.html');
const states=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const out={};const errs=[];
(async()=>{
  const b=await chromium.launch();
  const groups={};for(const s of states){const k=(s.ww||1440)+'x'+(s.h||900);(groups[k]=groups[k]||[]).push(s)}
  for(const [k,list] of Object.entries(groups)){
    const [w,h]=k.split('x').map(Number);
    const p=await b.newPage({viewport:{width:w,height:h},reducedMotion:'reduce'});
    p.on('pageerror',e=>errs.push(e.message));
    await p.route('**/live.js*',r=>r.fulfill({body:'',contentType:'text/javascript'}));
    await p.goto(PROTO);await p.waitForTimeout(150);
    for(const s of list){
      await p.evaluate(()=>{document.querySelectorAll('.menu,.confirm,.toast').forEach(e=>e.remove());const k=document.querySelector('#ksheet');if(k&&!k.hidden){k.hidden=true;document.querySelector('#kscrim').hidden=true}document.activeElement&&document.activeElement.blur&&document.activeElement.blur();if(document.querySelector('#side').hidden) document.querySelector('#railchats').click()});
      await p.evaluate(([t,ww])=>{__proto.reset();__proto.theme(t);__proto.ww(ww)},[s.theme||'light',w]);
      if(s.preset) await p.evaluate(id=>__proto.preset(id),s.preset);
      await p.waitForTimeout(s.wait0||120);
      for(const a of (s.actions||[])){
        if(a.click) await p.click(a.click,{force:true});
        else if(a.hover) await p.hover(a.hover);
        else if(a.type) await p.keyboard.type(a.type);
        else if(a.press) await p.keyboard.press(a.press);
        else if(a.fill) await p.fill(a.fill[0],a.fill[1]);
        else if(a.js) await p.evaluate(a.js);
        else if(a.mouse) await p.mouse.move(a.mouse[0],a.mouse[1]);
        await p.waitForTimeout(a.wait||120);
      }
      await p.waitForTimeout(s.wait||200);
      const html=await p.evaluate(()=>{
        // whitespace-only text nodes: the canvas runtime drops them, so drop them where layout ignores them and pin the rest with a zero-width space
        const tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const kill=[];let n;
        while((n=tw.nextNode())){
          if(n.__mf) continue;
          if(/\S/.test(n.nodeValue.replace(/​/g,'x'))) {n.__mf=1;continue}
          const par=n.parentElement;if(!par||par.closest('script,style,svg')) continue;
          const cs=getComputedStyle(par);const pre=/pre/.test(cs.whiteSpace);
          // whitespace beside block-level siblings (or at a block's edge) renders nothing; pinning it would add empty line boxes
          const blk=x=>!x||(x.nodeType===1&&!/^inline|^contents/.test(getComputedStyle(x).display));
          const edge=blk(n.previousSibling)&&blk(n.nextSibling);
          if(!pre&&(/flex|grid/.test(cs.display)||edge)) kill.push(n);else {n.nodeValue='​'+n.nodeValue;n.__mf=1}
        }
        kill.forEach(k=>k.remove());
        document.querySelectorAll('textarea').forEach(t=>{t.textContent=t.value});
        document.querySelectorAll('input').forEach(i=>{if(i.type==='checkbox'||i.type==='radio'){if(i.checked)i.setAttribute('checked','');else i.removeAttribute('checked')}else i.setAttribute('value',i.value)});
        const parts=[];
        // a clone loses scroll offsets: pin each scrolled area's content where it sits on screen
        const sc=[...document.querySelectorAll('.stage *')].filter(e=>e.scrollTop>0);
        sc.forEach(e=>e.setAttribute('data-mfscroll',e.scrollTop));
        const stage=document.querySelector('.stage').cloneNode(true);
        sc.forEach(e=>e.removeAttribute('data-mfscroll'));
        stage.querySelectorAll('[data-mfscroll]').forEach(e=>{const y=e.getAttribute('data-mfscroll');e.removeAttribute('data-mfscroll');[...e.children].forEach(c=>{c.style.translate='0 -'+y+'px'})});
        stage.querySelectorAll('#pc,script').forEach(e=>e.remove());
        parts.push(stage.outerHTML);
        document.querySelectorAll('body > .menu, body > .confirm, body > .seltb:not([hidden])').forEach(e=>parts.push(e.outerHTML));
        const tip=document.querySelector('#tip');if(tip&&!tip.hidden) parts.push(tip.outerHTML);
        const ks=document.querySelector('#ksheet');if(ks&&!ks.hidden){parts.push(document.querySelector('#kscrim').outerHTML);parts.push(ks.outerHTML)}
        return parts.join('\n');
      });
      out[s.id]={html:numberIds(html,s.id),w,h};
      process.stdout.write('.');
    }
    await p.close();
  }
  if(!out.__sprite){const p=await b.newPage();await p.route('**/live.js*',r=>r.fulfill({body:'',contentType:'text/javascript'}));await p.goto(PROTO);out.__sprite={html:await p.evaluate(()=>document.querySelector('body > svg').outerHTML)};await p.close()}
  fs.writeFileSync(process.argv[3],JSON.stringify(out));
  console.log('\ncaptured',Object.keys(out).length-1,'errors',errs.length,errs.slice(0,5));
  await b.close();
})();
