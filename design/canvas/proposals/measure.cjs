const {chromium}=require(require('path').resolve(__dirname,'../../../packages/e2e/node_modules/@playwright/test'));const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1360,height:900}});
const src=fs.readFileSync(process.argv[2],'utf8');const body=src.slice(src.indexOf('</helmet>')+9,src.indexOf('</x-dc>'));
await p.setContent('<body style="margin:0">'+body+'</body>');console.log(await p.evaluate(()=>document.body.firstElementChild.getBoundingClientRect().height));await b.close()})();
