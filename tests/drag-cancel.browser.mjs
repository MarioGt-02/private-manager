// Browser-only regression harness. All mutations, Activity and AI responses are fixtures.
// Uses installed esbuild and a caller-provided Playwright module; never contacts provider/DB.
import { createRequire } from "node:module";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.cwd();
const output = process.env.UI_SCREENSHOT_DIR;
if (!output) throw new Error("Set UI_SCREENSHOT_DIR to a screenshot directory");
await mkdir(output, {recursive:true});
const bundled = await build({ entryPoints:["tests/fixtures/ui-harness.tsx"], absWorkingDir:root, bundle:true, write:false, format:"iife", platform:"browser", jsx:"automatic", define:{"process.env.NODE_ENV":'"development"'}, plugins:[{name:"fixture-actions",setup(b){b.onResolve({filter:/^@\/lib\/actions\/object-actions$/},()=>({path:path.join(root,"tests/fixtures/ui-actions.ts")}));}}] });
const files = await readdir(path.join(root,".next/static"),{recursive:true});
const css = (await Promise.all(files.filter(f=>f.endsWith('.css')).map(f=>readFile(path.join(root,'.next/static',f),'utf8')))).join('\n');
const server = createServer((req,res)=>{ if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(bundled.outputFiles[0].text);}else if(req.url==='/app.css'){res.setHeader('content-type','text/css');res.end(css);}else{res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');} });
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base={title:'History',goal:'',currentState:'Imported history.',nextAction:'检查并将对象标记为已完成。',checklist:[],archivedAt:'2026-01-27T10:00:00Z',cancelledAt:null};
let history=[{...base,id:'past-doing',title:'Historical Doing Object',status:'doing'},{...base,id:'past-done',title:'Completed printer repair',status:'done'},{...base,id:'past-ready',title:'Cancelled car wrap',status:'ready',cancelledAt:'2026-01-27T10:00:00Z'}];
let calls=[];let cancelCalls=0;let failCancel=false;
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url());const state=await page.evaluate(()=>structuredClone(window.uiFixture));let result={};let contentType='application/json';
 if(url.pathname==='/api/objects/archived'){
  const status=url.searchParams.get('status');const filter=url.searchParams.get('filter');calls.push(status);
  result={objects:history.filter(o=>o.status===status).filter(o=>filter==='cancelled'?!!o.cancelledAt:filter==='completed'?!o.cancelledAt:true),nextOffset:null};
 }else if(url.pathname.endsWith('/activity')){result={updates:[]};}
 else if(url.pathname.endsWith('/lifecycle')){
  const id=url.pathname.split('/')[3];const body=route.request().postDataJSON();let object=history.find(o=>o.id===id)||state.objects.find(o=>o.id===id);
  assert(object);if(body.action==='cancel'){cancelCalls++;assert.equal(body.confirmed,true);if(failCancel){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{message:'Simulated failure'}})});return;}}
  object={...object,archivedAt:body.action==='restore'?null:new Date().toISOString(),cancelledAt:body.action==='restore'?null:body.action==='cancel'?new Date().toISOString():object.cancelledAt};
  history=history.filter(o=>o.id!==id);if(object.archivedAt)history.push(object);
  await page.evaluate(object=>{const store=window.uiFixture;store.objects=store.objects.filter(o=>o.id!==object.id);if(!object.archivedAt)store.objects.push(object);},object);
  result={object};
 }else if(url.pathname.startsWith('/api/export/')){
  const objects=[...state.objects,...history];
  if(url.pathname.endsWith('/json')) result={format:'private-manager-export',version:1,objects,checklistItems:[],objectUpdates:[]};
  else{result='id,title,status,archived,cancelled\r\n'+objects.map(o=>`${o.id},${JSON.stringify(o.title)},${o.status},${!!o.archivedAt},${!!o.cancelledAt}`).join('\r\n');contentType='text/csv';}
 }else if(url.pathname.startsWith('/api/objects/')){const id=url.pathname.split('/')[3];result={object:history.find(o=>o.id===id)};}
 else throw new Error('Unexpected fixture request');
 await route.fulfill({status:200,contentType,body:typeof result==='string'?result:JSON.stringify(result)});
});
async function dragToCancel(){
 await page.getByRole('dialog').waitFor({state:'hidden'});
 const card=page.getByRole('button',{name:/^Open Object:/}).first();await card.scrollIntoViewIfNeeded();const box=await card.boundingBox();
 await page.mouse.move(box.x+35,box.y+30);await page.mouse.down();await page.mouse.move(box.x+55,box.y+50,{steps:5});
 const zone=page.locator('[aria-label="拖拽取消区域"]');await zone.waitFor();const target=await zone.boundingBox();
 await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:20});
 await page.getByText('松手后确认取消',{exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'drag-cancel-target.png')});
 await page.mouse.up();await page.getByRole('dialog',{name:'确认取消对象'}).waitFor();
}
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:/^Open Object:/}).first().click();
 const drawer=page.getByRole('dialog',{name:'Object details'});
 const archive=drawer.getByRole('button',{name:'Archive Object',exact:true});
 const cancel=drawer.getByRole('button',{name:'Delete Object',exact:true});
 assert.equal(await archive.evaluate(e=>!!e.closest('header')),true);assert.equal(await cancel.evaluate(e=>!!e.closest('header')),true);
 await page.screenshot({path:path.join(output,'drawer-header-actions.png')});
 await drawer.getByRole('button',{name:'Close Object Drawer'}).click();
 await dragToCancel();assert.equal(cancelCalls,0);assert.equal(await page.evaluate(()=>window.uiFixture.objects[0].status),'doing');
 await page.getByRole('button',{name:'保留卡片',exact:true}).click();assert.equal(cancelCalls,0);
 await page.getByRole('button',{name:/^Open Object:/}).first().click();await page.getByRole('dialog',{name:'Object details'}).waitFor();
 await page.getByRole('button',{name:'Close Object Drawer'}).click();
 await dragToCancel();failCancel=true;
 const confirmation=page.getByRole('dialog',{name:'确认取消对象'});
 await confirmation.getByRole('button',{name:'确认取消',exact:true}).click();
 await confirmation.getByText('取消失败，卡片尚未移除，请重试。',{exact:true}).waitFor();
 assert.equal(cancelCalls,1);assert.equal(await page.evaluate(()=>window.uiFixture.objects.some(o=>o.id==='fixture-object'&&!o.archivedAt)),true);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await confirmation.evaluate(e=>e.scrollWidth>e.clientWidth),false);
 await page.screenshot({path:path.join(output,'drag-cancel-confirm-mobile.png')});
 failCancel=false;await confirmation.getByRole('button',{name:'确认取消',exact:true}).click();
 const history=page.getByRole('dialog',{name:'Archived — Doing'});await history.waitFor();
 await history.getByRole('button',{name:'Cancelled',exact:true}).click();
 const record=history.locator('li').filter({hasText:'安装120×60cm'});await record.waitFor();
 assert.equal(cancelCalls,2);await record.getByText('Cancelled',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.uiFixture.objects.some(o=>o.id==='fixture-object')),false);
 await record.getByRole('button',{name:'Restore',exact:true}).click();await history.getByText('No archived Objects here yet.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.uiFixture.objects.find(o=>o.id==='fixture-object').status),'doing');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('Drag-cancel browser fixtures passed: top-right separate Archive/Cancel, drag target, no mutation before confirmation, keep card, failure retention/retry, preserved Doing status, cancelled history and restore. Zero real data mutations.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
