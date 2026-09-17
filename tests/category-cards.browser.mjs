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
const bundled = await build({ entryPoints:["tests/fixtures/category-board.tsx"], absWorkingDir:root, bundle:true, write:false, format:"iife", platform:"browser", jsx:"automatic", define:{"process.env.NODE_ENV":'"development"'}, plugins:[{name:"fixture-actions",setup(b){b.onResolve({filter:/^@\/lib\/actions\/object-actions$/},()=>({path:path.join(root,"tests/fixtures/ui-actions.ts")}));}}] });
const files = await readdir(path.join(root,".next/static"),{recursive:true});
const css = (await Promise.all(files.filter(f=>f.endsWith('.css')).map(f=>readFile(path.join(root,'.next/static',f),'utf8')))).join('\n');
const server = createServer((req,res)=>{ if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(bundled.outputFiles[0].text);}else if(req.url==='/app.css'){res.setHeader('content-type','text/css');res.end(css);}else{res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');} });
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1920,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));let calls=0;
await page.route('**/api/**',route=>{calls++;const archived=route.request().url().includes('/archived?');return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(archived?{objects:[{id:'cancelled-category',title:'Cancelled historical Object',status:'ready',category:'Informatica',archivedAt:'2026-01-01T10:00:00Z',cancelledAt:'2026-01-01T10:00:00Z'}],nextOffset:null}:{updates:[]})});});
try{
 await page.addInitScript(()=>localStorage.setItem('private-manager:column-width:ready','850'));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const ready=page.locator('section').filter({has:page.getByRole('heading',{name:'Ready',exact:true})});const cards=ready.locator('article');await cards.first().waitFor();
 const styles=await cards.evaluateAll(items=>items.map(item=>({background:getComputedStyle(item).backgroundColor,border:getComputedStyle(item).borderLeftWidth,accent:getComputedStyle(item).borderLeftColor,height:item.getBoundingClientRect().height,titleClamp:getComputedStyle(item.querySelector('h3')).webkitLineClamp,currentClamp:getComputedStyle(item.querySelector('.line-clamp-3')).webkitLineClamp})));
 assert(styles.every(s=>s.background==='rgb(255, 255, 255)'&&s.border==='5px'&&s.titleClamp==='2'&&s.currentClamp==='3'&&s.height<360));assert.equal(new Set(styles.map(s=>s.accent)).size,6);
 assert.equal(await cards.first().getByRole('progressbar').count(),0);assert.equal(await cards.first().getByText('No checklist',{exact:true}).count(),1);assert.equal(calls,0);
 await page.screenshot({path:path.join(output,'category-cards-desktop.png')});
 const state=await page.evaluate(()=>structuredClone(window.uiFixture.objects[0]));
 await cards.first().click();const dialog=page.getByRole('dialog',{name:'Object details'});await dialog.waitFor();
 assert.equal(await dialog.getByText(state.currentState,{exact:true}).innerText(),state.currentState);assert.equal(await dialog.getByText(state.title,{exact:true}).innerText(),state.title);
 await dialog.getByRole('button',{name:'Close Object Drawer'}).click();
 await page.getByRole('button',{name:'Archived Ready Objects',exact:true}).click();const archive=page.getByRole('dialog',{name:'Archived — Ready'});await archive.getByText('Cancelled historical Object',{exact:true}).waitFor();
 assert.match(await archive.getByText('Cancelled historical Object',{exact:true}).getAttribute('class'),/line-through/);assert.equal(await archive.getByText('Informatica',{exact:true}).count(),1);assert.equal(await archive.getByText('Cancelled',{exact:true}).count(),2);
 await page.screenshot({path:path.join(output,'category-archive.png')});await archive.getByRole('button',{name:'Close',exact:true}).click();
 await page.setViewportSize({width:390,height:844});const handle=page.getByRole('separator',{name:'Ready 列宽',exact:true});await handle.press('Home');await cards.first().scrollIntoViewIfNeeded();
 assert.equal(await cards.first().evaluate(element=>element.scrollWidth>element.clientWidth),false);await page.screenshot({path:path.join(output,'category-card-mobile.png')});
 assert.equal(errors.length,0,errors.join('\n'));console.log('Category card visual acceptance passed: 5px accents/white surfaces, six palettes, 2-line titles/3-line Current, compact heights, no 0/0, full Drawer content, category+Cancelled archive treatment, mobile wrapping. Fixture data only.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}