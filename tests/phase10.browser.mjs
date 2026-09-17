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
let calls=[];let cancelCalls=0;let deleteCalls=0;let failDelete=true;
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url());const state=await page.evaluate(()=>structuredClone(window.uiFixture));let result={};let contentType='application/json';
 if(url.pathname==='/api/categories'){result={categories:[]};}
 else if(route.request().method()==='DELETE'){
  deleteCalls++;assert.equal(route.request().postDataJSON().confirmed,true);
  if(failDelete){failDelete=false;await route.fulfill({status:500,json:{error:{message:'Simulated failure'}}});return;}
  const id=url.pathname.split('/')[3];
  await page.evaluate(id=>{window.uiFixture.objects=window.uiFixture.objects.filter(o=>o.id!==id);},id);
  history=history.filter(o=>o.id!==id);
  await route.fulfill({status:204});return;
 }else if(url.pathname==='/api/objects/archived'){
  const status=url.searchParams.get('status');const filter=url.searchParams.get('filter');calls.push(status);
  result={objects:history.filter(o=>o.status===status).filter(o=>filter==='cancelled'?!!o.cancelledAt:filter==='completed'?!o.cancelledAt:true),nextOffset:null};
 }else if(url.pathname.endsWith('/activity')){result={updates:[]};}
 else if(url.pathname.endsWith('/lifecycle')){
  const id=url.pathname.split('/')[3];const body=route.request().postDataJSON();let object=history.find(o=>o.id===id)||state.objects.find(o=>o.id===id);
  assert(object);if(body.action==='cancel'){cancelCalls++;assert.equal(body.confirmed,true);}
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
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'Archived Doing Objects',exact:true}).click();
 let archive=page.getByRole('dialog',{name:'Archived — Doing',exact:true});
 await archive.getByText('Historical Doing Object',{exact:true}).waitFor();
 assert.equal(await archive.getByText('Completed printer repair',{exact:true}).count(),0);
 assert.equal(await archive.getByRole('button',{name:'Completed',exact:true}).count(),0);
 await archive.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Archived Ready Objects',exact:true}).click();archive=page.getByRole('dialog',{name:'Archived — Ready',exact:true});
 await archive.getByRole('button',{name:'Cancelled',exact:true}).click();
 const cancelled=archive.getByText('Cancelled car wrap',{exact:true});await cancelled.waitFor();assert.match(await cancelled.getAttribute('class'),/line-through/);
 await page.screenshot({path:path.join(output,'phase10-cancelled-ready.png')});
 await archive.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Archived Done Objects',exact:true}).click();archive=page.getByRole('dialog',{name:'Archived — Done',exact:true});
 await archive.getByRole('button',{name:'Completed',exact:true}).click();await archive.getByText('Completed printer repair',{exact:true}).waitFor();
 assert.equal(await archive.getByText('Cancelled car wrap',{exact:true}).count(),0);
 await archive.getByRole('button',{name:'Close',exact:true}).click();
 const title=await page.evaluate(()=>window.uiFixture.objects[0].title);
 await page.getByRole('button',{name:/^Open Object:/}).first().click();let detail=page.getByRole('dialog',{name:'Object details',exact:true});
 await detail.getByRole('button',{name:'Archive Object',exact:true}).click();archive=page.getByRole('dialog',{name:'Archived — Doing',exact:true});
 await archive.getByText(title,{exact:true}).click();detail=page.getByRole('dialog',{name:'Object details',exact:true});
 await detail.getByText('Archived',{exact:true}).waitFor();assert.equal(await detail.getByRole('button',{name:'Edit Title',exact:true}).isDisabled(),true);
 await detail.getByRole('button',{name:'Restore to Board',exact:true}).click();
 await page.waitForFunction(()=>window.uiFixture.objects.some(o=>o.id==='fixture-object'&&!o.archivedAt&&o.status==='doing'));
 await detail.getByRole('button',{name:'Close Object Drawer'}).click();await archive.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:/^Open Object:/}).first().click();detail=page.getByRole('dialog',{name:'Object details',exact:true});
 await detail.getByRole('button',{name:'Delete Object',exact:true}).click();assert.equal(deleteCalls,0);
 await detail.getByRole('button',{name:'Keep Object',exact:true}).click();assert.equal(deleteCalls,0);
 await detail.getByRole('button',{name:'Delete Object',exact:true}).click();
 await page.screenshot({path:path.join(output,'object-delete-confirmation.png')});
 await detail.getByRole('button',{name:'Confirm deletion',exact:true}).click();
 await detail.getByText('删除失败，对象仍保留，请重试。',{exact:true}).waitFor();
 assert.equal(await detail.isVisible(),true);assert.equal(await page.evaluate(()=>window.uiFixture.objects.length),1);
 await detail.getByRole('button',{name:'Confirm deletion',exact:true}).click();
 await detail.waitFor({state:'hidden'});assert.equal(deleteCalls,2);assert.equal(cancelCalls,0);
 assert.equal(await page.locator('section').filter({has:page.getByRole('heading',{name:'Doing',exact:true})}).getByRole('button',{name:/^Open Object:/}).count(),0);
 for (const [status, label, archivedTitle] of [['Doing','Doing','Historical Doing Object'],['Ready','Ready','Cancelled car wrap'],['Done','Done','Completed printer repair']]) {
  await page.getByRole('button',{name:`Archived ${status} Objects`,exact:true}).click();
  archive=page.getByRole('dialog',{name:`Archived — ${label}`,exact:true});
  await archive.getByText(archivedTitle,{exact:true}).click();
  detail=page.getByRole('dialog',{name:'Object details',exact:true});
  assert.equal(await detail.getByRole('button',{name:'Edit Title',exact:true}).isDisabled(),true);
  const before=deleteCalls;
  await detail.getByRole('button',{name:'Delete Object',exact:true}).click();
  await detail.getByRole('button',{name:'Keep Object',exact:true}).click();assert.equal(deleteCalls,before);
  await detail.getByRole('button',{name:'Delete Object',exact:true}).click();
  if(status==='Doing') {
   failDelete=true;
   await detail.getByRole('button',{name:'Confirm deletion',exact:true}).click();
   await detail.getByText('删除失败，对象仍保留，请重试。',{exact:true}).waitFor();
   assert(history.some(object=>object.title===archivedTitle));
  }
  await detail.getByRole('button',{name:'Confirm deletion',exact:true}).click();
  await detail.waitFor({state:'hidden'});
  await archive.getByText('No archived Objects here yet.',{exact:true}).waitFor();
  assert.equal(await archive.getByText(archivedTitle,{exact:true}).count(),0);
  await archive.getByRole('button',{name:'Close',exact:true}).click();
 }
 await page.getByRole('button',{name:'Data / Export',exact:true}).click();const data=page.getByRole('dialog',{name:'Export all data',exact:true});
 for(const format of ['JSON','CSV']){const download=page.waitForEvent('download');await data.getByRole('button',{name:'Export '+format,exact:true}).click();const file=await download;assert(file.suggestedFilename().endsWith('.'+format.toLowerCase()));await file.saveAs(path.join(output,'phase10-fixture-export.'+format.toLowerCase()));}
 await page.screenshot({path:path.join(output,'phase10-data-export.png')});
 assert.equal(errors.length,0,errors.join('\n'));assert(calls.includes('doing')&&calls.includes('ready')&&calls.includes('done'));
 console.log('Browser fixtures passed: archive/restore, delete confirmation/keep/failure/retry, removal after success, JSON/CSV downloads. Zero live DB/provider calls.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
