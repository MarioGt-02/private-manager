// Browser-only regression harness. All mutations, Activity and AI responses are fixtures.
// Uses installed esbuild and a caller-provided Playwright module; never contacts provider/DB.
import { createRequire } from "node:module";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
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
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
let activityReads=0, analyzes=0, applies=0, failApply=true, createCalls=0;
await page.route('**/api/**',async route=>{
 const url=route.request().url(); const state=await page.evaluate(()=>structuredClone(window.uiFixture)); const object=state.objects[0];
 let body={}; let status=200;
 if(url.endsWith('/activity')){ activityReads++; body={updates:state.events.slice(0,30)}; }
 else if(url.endsWith('/progress/analyze')){analyzes++;body={update:{currentState:'Mounting hardware prepared.',nextAction:'This AI text must not be displayed',completedItemIds:['fixture-item-1'],reopenedItemIds:[],newChecklistItems:[{title:'Test mounting strength'}],summary:'Prepared hardware.'}};}
 else if(url.endsWith('/replan/analyze')){analyzes++;body={proposal:{title:'免打孔安装电竞洞洞板',goal:'Use removable desk clamps',currentState:'Wall drilling is not allowed.',reasonSummary:'Rental wall constraint.',checklist:object.checklist.slice(0,3).map((item,i)=>({sourceItemId:item.id,title:i===1?'Prepare desk clamps':item.title,completed:item.completed,position:i,changeType:i===1?'modify':'keep'})).concat([{sourceItemId:null,title:'Test clamp load',completed:false,position:3,changeType:'add'}]),removedItemIds:object.checklist.slice(3).map(item=>item.id),summary:'Replanned to desk clamps.'}};}
 else if(url.endsWith('/apply')){applies++;if(failApply){status=500;body={error:{message:'Simulated failure'}};}else{body={object:{...object,currentState:'Confirmed preview applied.'}};}}
 else if(url.endsWith('/create-object/chat')){analyzes++;createCalls++;body={message:'Here is your draft.',phase:'proposal',draft:{title:'Create a desk video',goal:'Explain the build',currentState:'Outline complete',nextAction:'Record camera test',checklist:[{title:'Record camera test',completed:false,position:0}]}};if(createCalls===1)body={message:'Please review the idea. '+ '多语言长回复 — clarify the complete outcome. '.repeat(150),phase:'clarifying',draft:null};}
 else if(url.endsWith('/create-object/finalize')){const data=route.request().postDataJSON();body={object:{...data.draft,id:'fixture-created',status:'idea',checklist:data.draft.checklist.map((i,n)=>({...i,id:'created-'+n}))}};}
 else throw new Error('Unexpected API request');
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
});
async function checkOverflow(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false); const dialog=page.getByRole('dialog');if(await dialog.count()) assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth),false);}
try {
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:/^Open Object:/}).first().waitFor();
 await page.screenshot({path:path.join(output,'board-desktop.png')});
 await page.getByRole('button',{name:/^Open Object:/}).first().press('Enter');
 const dialog=page.getByRole('dialog',{name:'Object details'});await dialog.waitFor();await checkOverflow();
 await page.screenshot({path:path.join(output,'drawer-desktop.png')});
 await dialog.getByRole('button',{name:'Edit Title',exact:true}).click();
 await dialog.getByLabel('Title',{exact:true}).fill('Make desk build video');
 await dialog.getByLabel('Title',{exact:true}).press('Control+Enter');
 await dialog.getByText('Make desk build video',{exact:true}).waitFor();
 assert(activityReads>0);
 await dialog.getByRole('button',{name:'Edit Goal',exact:true}).click();
 await dialog.getByLabel('Goal',{exact:true}).fill('Unsaved goal text');
 await page.evaluate(()=>window.uiFixture.failNext=true);
 await dialog.getByRole('button',{name:'Save',exact:true}).click();
 await dialog.getByText('Could not save changes. Please try again.').waitFor();
 assert.equal(await dialog.getByLabel('Goal',{exact:true}).inputValue(),'Unsaved goal text');
 await dialog.getByLabel('Goal',{exact:true}).press('Escape');assert.equal(await dialog.isVisible(),true);
 await dialog.getByRole('checkbox').first().uncheck();
 await page.waitForFunction(()=>window.uiFixture.events.some(e=>e.type==='checklist_changed'));
 await dialog.getByRole('textbox',{name:'Add checklist item',exact:true}).fill('Create thumbnail');
 await dialog.getByRole('button',{name:'Add item',exact:true}).click();
 await dialog.getByText('Create thumbnail',{exact:true}).waitFor();
 const row=dialog.locator('li').filter({hasText:'Create thumbnail'});
 await row.getByRole('button',{name:/Move .* up/}).click();
 await page.waitForFunction(()=>window.uiFixture.objects[0].checklist.at(-2)?.title==='Create thumbnail');
 await row.getByRole('button',{name:/Edit Checklist item/}).click();
 await row.getByRole('textbox').fill('Design thumbnail');
 await dialog.getByRole('button',{name:'Save',exact:true}).click();
 await dialog.getByText('Design thumbnail',{exact:true}).waitFor();
 await dialog.locator('li').filter({hasText:'Design thumbnail'}).getByRole('button',{name:/Delete/}).click();
 await page.waitForFunction(()=>!window.uiFixture.objects[0].checklist.some(item=>item.title==='Design thumbnail'));
 const before=analyzes;
 await dialog.getByRole('button',{name:'Replan',exact:true}).click();
 assert.equal(await dialog.getByRole('textbox',{name:'What happened?',exact:true}).isVisible(),false);
 assert.equal(analyzes,before);
 await dialog.getByLabel('What changed?',{exact:true}).fill('Rental wall, cannot drill.');
 await dialog.getByRole('button',{name:'Analyze Replan',exact:true}).click();
 await dialog.getByText('Review replan',{exact:true}).waitFor();
 assert.equal(await dialog.getByText('MODIFY',{exact:true}).count(),1);
 assert.equal(await dialog.getByText('After: 免打孔安装电竞洞洞板',{exact:true}).count(),1);
 await dialog.getByRole('button',{name:'Apply Replan',exact:true}).click();
 await dialog.getByText('Could not apply replan. Your preview is still here.').waitFor();
 await dialog.getByText('Review replan',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await checkOverflow();
 await dialog.getByText('Review replan',{exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(output,'replan-mobile.png')});
 failApply=false;
 await dialog.getByRole('button',{name:'Apply Replan',exact:true}).click();
 await dialog.getByLabel('What changed?',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Update Progress',exact:true}).click();
 await dialog.getByLabel('What happened?',{exact:true}).fill('Hardware is ready.');
 await dialog.getByRole('button',{name:'Analyze Progress',exact:true}).click();
 await dialog.getByText('Review progress update',{exact:true}).waitFor();
 assert.equal(await dialog.getByText('This AI text must not be displayed',{exact:true}).count(),0);
 await dialog.getByRole('button',{name:'Apply Update',exact:true}).click();
 await dialog.getByLabel('What happened?',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Close Object Drawer'}).click();
 await page.setViewportSize({width:1440,height:1000});
 const card=page.getByRole('button',{name:/^Open Object:/}).first(); const box=await card.boundingBox();
 const target=page.locator('section').filter({has:page.getByRole('heading',{name:'Ready',exact:true})});const drop=await target.boundingBox();
 await page.mouse.move(box.x+30,box.y+30);await page.mouse.down();await page.mouse.move(drop.x+80,drop.y+90,{steps:15});await page.mouse.up();
 await page.waitForFunction(()=>window.uiFixture.objects[0].status==='ready');
 await page.getByRole('button',{name:'✨ AI Create',exact:true}).click();
 const create=page.getByRole('dialog',{name:'AI Create',exact:true});
 await create.getByLabel('Your message',{exact:true}).fill('Make a video');
 await create.getByRole('button',{name:'Send',exact:true}).click();
 await create.getByText(/^Please review the idea/).waitFor();
 await checkOverflow();
 await page.screenshot({path:path.join(output,'ai-create-long-conversation.png')});
 await create.getByLabel('Your message',{exact:true}).fill('The goal is clear, propose a draft.');
 await create.getByRole('button',{name:'Send',exact:true}).click();
 await create.getByLabel('Title',{exact:true}).waitFor();
 await create.getByRole('button',{name:'Create Object',exact:true}).click();
 await page.getByRole('dialog',{name:'Object details'}).waitFor();
 await checkOverflow();
 await page.getByRole('dialog',{name:'Object details'}).getByRole('button',{name:'Close Object Drawer'}).click();
 await page.addInitScript(() => { window.__emptyFixture = true; });
 await page.reload();
 await page.getByRole('button',{name:/^Open Object:/}).first().click();
 await page.getByText('No checklist items yet.',{exact:true}).waitFor();
 await page.getByText('No activity yet.',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await checkOverflow();
 await page.screenshot({path:path.join(output,'empty-drawer-mobile.png')});
 assert.equal(errors.length,0,errors.join('\n'));
 console.log(`Browser fixture regression passed: manual save/failure, check/add/rename/delete/reorder, exclusive AI panels, Replan diff/failure/retry, Progress, AI Create, drag/drop. ${activityReads} activity reads, ${analyzes} mocked analyses, ${applies} mocked applies. Desktop/mobile overflow checks passed.`);
 await writeFile(path.join(output,'result.txt'),'Browser fixture regression passed. All services mocked; no live database/provider calls.');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
