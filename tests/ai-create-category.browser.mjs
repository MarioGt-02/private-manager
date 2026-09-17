// Real AI Create components, intercepted API fixtures. No provider or user DB writes.
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const css = (await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
const bundle = await build({ stdin: { contents: 'import {createRoot} from "react-dom/client"; import {useState} from "react"; import {AICreateDialog} from "./components/ai/AICreateDialog"; function App(){const [open,setOpen]=useState(true); return <><button onClick={()=>setOpen(true)}>Reopen AI</button><AICreateDialog open={open} onClose={()=>setOpen(false)} onCreated={object=>{window.created=object;setOpen(false)}}/></>} createRoot(document.getElementById("root")).render(<App/>);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const server = createServer((req, res) => {
  if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); }
  else if (req.url === "/app.css") { res.setHeader("content-type", "text/css"); res.end(css); }
  else { res.setHeader("content-type", "text/html"); res.end('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
const errors = []; page.on("pageerror", error => errors.push(error.message));
const categories = ["Tech & Software", "Vehicles", "Maker & DIY", "Study & Learning", "Personal domain"].map((name, index) => ({ id: `category-${index}`, name }));
const cases = [["Add automated backups to Private Manager", 0], ["给 Audi A3 贴车窗黑膜", 1], ["做一个3D打印的洞洞板支架", 2], ["准备 Polito 数学考试", 3], ["以后想处理一些事情", null]];
let suggestion = null, chatCalls = 0, writes = [], rejectDeleted = false, clarify = false;
await page.route("**/api/**", async route => {
  const url = route.request().url(); const body = route.request().postDataJSON();
  if (url.endsWith("/chat")) {
    chatCalls++;
    if (clarify) { await route.fulfill({json:{message:"What size do you have in mind?",phase:"clarifying",draft:null,categories}});return; }
    await route.fulfill({ json: { message: "Review this suggestion", phase: "proposal", categories, draft: { title: body.messages.at(-1).content, goal: "Complete this outcome", currentState: "No execution reported", nextAction: "Start first step", checklist: [{ title: "Start first step", completed: false, position: 0 }], categoryId: suggestion } } });
  } else if (url.endsWith("/finalize")) {
    writes.push(body);
    if (rejectDeleted) { rejectDeleted = false; await route.fulfill({ status: 400, json: { error: { message: "The selected category no longer exists. Choose another category or No category." } } }); }
    else await route.fulfill({ json: { object: { ...body.draft, id: "created", status: "idea" } } });
  } else throw new Error(`Unexpected request: ${url}`);
});
try {
  await mkdir("coverage/category-validation", { recursive: true });
  // Backdrop clicks/drags must not dismiss. Explicit close/Escape preserve state.
  clarify = true;
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("textbox").fill("Make a desk");
  await page.getByRole("button",{name:"Send",exact:true}).click();
  const dialog = page.getByRole("dialog",{name:"AI Create",exact:true});
  await page.getByText("What size do you have in mind?",{exact:true}).waitFor();
  await page.getByRole("textbox").fill("Unsent dimensions");
  await page.mouse.click(20,400);
  assert.equal(await dialog.isVisible(),true);
  const box=await page.getByRole("textbox").boundingBox();
  await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(20,400);await page.mouse.up();
  assert.equal(await dialog.isVisible(),true);
  for(const method of ["Close","Escape"]) {
    if(method==="Close") await dialog.getByRole("button",{name:"Close",exact:true}).click();
    else await page.keyboard.press("Escape");
    await dialog.waitFor({state:"hidden"});
    await page.getByRole("button",{name:"Reopen AI",exact:true}).click();
    await page.getByText("What size do you have in mind?",{exact:true}).waitFor();
    assert.equal(await page.getByRole("textbox").inputValue(),"Unsent dimensions");
  }
  clarify=false;suggestion=categories[0].id;
  await page.getByRole("button",{name:"Send",exact:true}).click();
  await page.getByLabel("Category",{exact:true}).selectOption(categories[4].id);
  await page.getByLabel("Title",{exact:true}).fill("Edited desk draft");
  await dialog.getByRole("button",{name:"Close",exact:true}).click();
  await page.getByRole("button",{name:"Reopen AI",exact:true}).click();
  assert.equal(await page.getByLabel("Title",{exact:true}).inputValue(),"Edited desk draft");
  assert.equal(await page.getByLabel("Category",{exact:true}).inputValue(),categories[4].id);
  await page.getByRole("button",{name:"新对话",exact:true}).click();
  await page.getByRole("button",{name:"保留对话",exact:true}).click();
  assert.equal(await page.getByLabel("Title",{exact:true}).inputValue(),"Edited desk draft");
  await page.getByRole("button",{name:"新对话",exact:true}).click();
  await page.getByRole("button",{name:"清空并开始",exact:true}).click();
  assert.equal(await page.getByRole("textbox").inputValue(),"");
  assert.equal(await page.getByRole("log").getByText("Make a desk",{exact:true}).count(),0);
  assert.equal(chatCalls,2);assert.equal(writes.length,0);
  console.log("Conversation retention passed: backdrop click/drag, close/Escape/reopen, unsent text, edited draft, explicit reset; zero incidental API calls.");
  for (const [input, index] of cases) {
    suggestion = index === null ? null : categories[index].id;
    for (const selection of [suggestion, categories[4].id, null]) {
      writes = []; chatCalls = 0;
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByRole("textbox").fill(input);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      const select = page.getByLabel("Category", { exact: true });
      await select.waitFor();
      assert.equal(await select.inputValue(), suggestion ?? "");
      assert.equal(await select.isEnabled(), true);
      assert.equal(await select.locator("option").count(), categories.length + 1);
      await select.selectOption(selection ?? "");
      assert.equal(writes.length, 0);
      if (selection === suggestion) await page.screenshot({ path: `coverage/category-validation/case-${index ?? "none"}.png` });
      await page.getByRole("button", { name: "Create Object", exact: true }).click();
      await page.waitForFunction(() => window.created);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].draft.categoryId, selection);
      assert.equal(await page.evaluate(() => window.created.categoryId), selection);
      assert.equal(chatCalls, 1);
    }
  }
  // Deleted category errors preserve the draft and allow explicit clearing/retry.
  suggestion = categories[0].id; rejectDeleted = true; writes = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload(); await page.getByRole("textbox").fill("Backups");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByLabel("Category", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Create Object", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("Category", { exact: true }).inputValue(), suggestion);
  await page.getByLabel("Category", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Create Object", exact: true }).click();
  await page.waitForFunction(() => window.created);
  assert.equal(writes[1].draft.categoryId, null);
  assert.deepEqual(errors, []);
  const report = "Passed: five draft suggestions × keep/change/clear, one chat request each, no writes before confirmation, deleted-category recovery, mobile interaction. API fixtures; DB persistence verified separately by integration tests.";
  await writeFile("coverage/category-validation/result.txt", report);
  console.log(report);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
