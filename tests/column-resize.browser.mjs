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
const bundled = await build({ entryPoints:["tests/fixtures/resizable-board.tsx"], absWorkingDir:root, bundle:true, write:false, format:"iife", platform:"browser", jsx:"automatic", define:{"process.env.NODE_ENV":'"development"'}, plugins:[{name:"fixture-actions",setup(b){b.onResolve({filter:/^@\/lib\/actions\/object-actions$/},()=>({path:path.join(root,"tests/fixtures/ui-actions.ts")}));}}] });
const files = await readdir(path.join(root,".next/static"),{recursive:true});
const css = (await Promise.all(files.filter(f=>f.endsWith('.css')).map(f=>readFile(path.join(root,'.next/static',f),'utf8')))).join('\n');
const server = createServer((req,res)=>{ if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(bundled.outputFiles[0].text);}else if(req.url==='/app.css'){res.setHeader('content-type','text/css');res.end(css);}else{res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');} });
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1920,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));let requests=0;
await page.route('**/api/**',route=>{requests++;return route.fulfill({status:200,contentType:'application/json',body:'{"updates":[]}'});});
const column=()=>page.locator('section').filter({has:page.getByRole('heading',{name:'Ready',exact:true})});
const handle=()=>page.getByRole('separator',{name:'Ready 列宽',exact:true});
async function resize(width){
 await handle().scrollIntoViewIfNeeded();const box=await handle().boundingBox();const old=Number(await handle().getAttribute('aria-valuenow'));
 await page.mouse.move(box.x+box.width/2,box.y+20);await page.mouse.down();await page.mouse.move(box.x+box.width/2+width-old,box.y+20,{steps:15});await page.mouse.up();
 await page.waitForFunction(width=>Number(document.querySelector('[aria-label="Ready 列宽"]').getAttribute('aria-valuenow'))===width,width);
}
async function assertColumns(count){
 const boxes=await column().locator('article').evaluateAll(items=>items.map(item=>({x:item.getBoundingClientRect().x,y:item.getBoundingClientRect().y,bottom:item.getBoundingClientRect().bottom,fragments:item.getClientRects().length})));
 const lanes=new Map();
 for(const box of boxes){const key=Math.round(box.x);const lane=lanes.get(key)||[];lane.push(box);lanes.set(key,lane);assert.equal(box.fragments,1,'Cards must not split across lanes');}
 assert.equal(lanes.size,count);
 for(const lane of lanes.values()){
  lane.sort((a,b)=>a.y-b.y);
  for(let i=1;i<lane.length;i++)assert(Math.abs(lane[i].y-lane[i-1].bottom-10)<2,'Each card follows the previous card without a grid-row hole');
 }
}
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);await handle().waitFor();await assertColumns(1);
 const readyCards=column().getByRole('button',{name:/^Open Object:/});const sourceBox=await readyCards.nth(0).boundingBox();const reorderTarget=await readyCards.nth(2).boundingBox();
 await page.mouse.move(sourceBox.x+40,sourceBox.y+30);await page.mouse.down();await page.mouse.move(reorderTarget.x+40,reorderTarget.y+reorderTarget.height-20,{steps:20});await page.mouse.up();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('section')).find(section=>section.querySelector('h2')?.textContent==='Ready')?.querySelectorAll('article')[0]?.getAttribute('aria-label')?.includes('Object 2'));
 const reorderedLabels=await readyCards.evaluateAll(items=>items.map(item=>item.getAttribute('aria-label')));assert(reorderedLabels[0].includes('Object 2'));assert(reorderedLabels[1].includes('Object 3'));assert(reorderedLabels[2].includes('Object 1'));
 await page.waitForFunction(()=>window.uiFixture.events.some(event=>event.type==='object_reordered'));
 await resize(600);await assertColumns(2);assert.equal(await page.getByRole('separator',{name:'Doing 列宽',exact:true}).getAttribute('aria-valuenow'),'300');
 await resize(850);await assertColumns(3);assert.equal(requests,0);assert.equal(await page.evaluate(()=>window.uiFixture.events.length),1);
 await page.screenshot({path:path.join(output,'ready-three-cards.png')});
 await page.reload();await handle().waitFor();assert.equal(await handle().getAttribute('aria-valuenow'),'850');await assertColumns(3);
 await handle().press('Home');await assertColumns(1);await handle().press('Shift+ArrowRight');await assertColumns(2);
 await handle().dblclick();await assertColumns(1);assert.equal(await handle().getAttribute('aria-valuenow'),'300');
 await resize(850);const card=column().getByRole('button',{name:/^Open Object:/}).first();const movedLabel=await card.getAttribute('aria-label');const movedTitle=movedLabel.replace('Open Object: ','');const cardBox=await card.boundingBox();
 const doing=page.locator('section').filter({has:page.getByRole('heading',{name:'Doing',exact:true})});const target=await doing.boundingBox();
 await page.mouse.move(cardBox.x+30,cardBox.y+30);await page.mouse.down();await page.mouse.move(target.x+70,target.y+90,{steps:20});await page.mouse.up();
 await page.waitForFunction(title=>window.uiFixture.objects.find(object=>object.title===title)?.status==='doing',movedTitle);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('Resizable columns passed: same-column card reorder, pointer resize 1→2→3 cards per row, independent widths, reload persistence, keyboard/reset, no API calls during resize, uneven-height cards with no internal row gaps, card drag between statuses after resizing. Fixture data only.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
