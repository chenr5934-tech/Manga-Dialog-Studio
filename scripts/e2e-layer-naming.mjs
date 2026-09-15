import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { guardUploads, restoreUploads } from "./_uploads-guard.mjs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? "D:/dsh工作区/_shots";

mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

guardUploads();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1720, height: 1000 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => void dialog.accept());

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(900);

async function clickByText(label) {
  for (const handle of await page.$$("button")) {
    const text = await handle.evaluate((element) => (element.innerText ?? "").trim());
    if (text === label) {
      await handle.evaluate((element) => element.click());
      return true;
    }
  }
  return false;
}

// ---------- 准备：造三个对象 ----------
await clickByText("布局");
await sleep(500);
await clickByText("新建分镜");
await sleep(700);
await clickByText("关闭");
await sleep(400);
await clickByText("对话框预设");
await sleep(500);
await page.evaluate(() => document.querySelector("[data-preset-id]")?.click());
await sleep(600);
await page.evaluate(() => document.querySelectorAll("[data-preset-id]")[1]?.click());
await sleep(700);

await page.evaluate(() => document.querySelector("[data-open-layers]")?.click());
await sleep(700);

const rowIds = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-layer-row]")).map((row) => row.getAttribute("data-layer-row"))
  );

const names = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-layer-name]")).map((node) => ({
      id: node.getAttribute("data-layer-name"),
      text: (node.innerText ?? "").trim()
    }))
  );

const base = await rowIds();
record("画布上有三项内容", base.length === 3, "列出 " + base.length + " 项");

// ---------- 1) 改名 ----------
await page.evaluate((id) => {
  document.querySelector('[data-layer-rename="' + id + '"]')?.click();
}, base[0]);
await sleep(400);

await page.evaluate((id) => {
  const input = document.querySelector('[data-layer-name-input="' + id + '"]');
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "主角特写");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}, base[0]);
await sleep(800);

const afterRename = await names();
record(
  "点「改名」能改掉某一项的名字",
  afterRename.find((item) => item.id === base[0])?.text === "主角特写",
  afterRename.map((item) => item.text.slice(0, 8)).join(" / ")
);

// 双击也能改名
await page.evaluate((id) => {
  const node = document.querySelector('[data-layer-name="' + id + '"]');
  node?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
}, base[1]);
await sleep(400);
const inputAppeared = await page.evaluate(
  (id) => Boolean(document.querySelector('[data-layer-name-input="' + id + '"]')),
  base[1]
);
record("双击名字也能进入改名", inputAppeared, "输入框=" + inputAppeared);
await page.keyboard.press("Escape");
await sleep(300);

// ---------- 2) 分组 ----------
await page.evaluate(() => document.querySelector("[data-layer-group-mode]")?.click());
await sleep(500);

const hasTools = await page.evaluate(() => ({
  make: Boolean(document.querySelector("[data-layer-make-group]")),
  leave: Boolean(document.querySelector("[data-layer-leave-group]")),
  boxes: document.querySelectorAll("[data-layer-check]").length
}));
record("进入整理模式后每行出现勾选框", hasTools.boxes === 3, "勾选框=" + hasTools.boxes);
record("提供建组与移出分组", hasTools.make && hasTools.leave, "建组=" + hasTools.make + " 移出=" + hasTools.leave);

await page.evaluate(() => document.querySelector("[data-layer-check-all]")?.click());
await sleep(300);
await page.evaluate(() => document.querySelector("[data-layer-make-group]")?.click());
await sleep(900);

const groupInfo = await page.evaluate(() => {
  const group = document.querySelector("[data-layer-group]");
  return {
    exists: Boolean(group),
    name: group?.querySelector("[data-layer-group-name]")?.innerText?.trim() ?? "",
    members: document.querySelectorAll("[data-layer-in-group]").length
  };
});
record("能把勾选的项建成一组", groupInfo.exists && groupInfo.members === 3, "成员=" + groupInfo.members);

// 组改名
const groupId = await page.evaluate(() => document.querySelector("[data-layer-group]")?.getAttribute("data-layer-group"));
await page.evaluate((id) => {
  document.querySelector('[data-layer-group-rename="' + id + '"]')?.click();
}, groupId);
await sleep(400);
await page.evaluate((id) => {
  const input = document.querySelector('[data-layer-group-name-input="' + id + '"]');
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "第一幕");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}, groupId);
await sleep(800);

const renamedGroup = await page.evaluate(
  (id) => document.querySelector('[data-layer-group-name="' + id + '"]')?.innerText?.trim() ?? "",
  groupId
);
record("分组也能命名", renamedGroup.includes("第一幕"), renamedGroup.slice(0, 20));
await page.screenshot({ path: SHOT_DIR + "/layer-group.png" });

// 折叠
await page.evaluate((id) => {
  document.querySelector('[data-layer-group-toggle="' + id + '"]')?.click();
}, groupId);
await sleep(500);
const collapsed = await page.evaluate(() => document.querySelectorAll("[data-layer-in-group]").length);
record("分组可以折叠收起", collapsed === 0, "折叠后可见成员=" + collapsed);

await page.evaluate((id) => {
  document.querySelector('[data-layer-group-toggle="' + id + '"]')?.click();
}, groupId);
await sleep(500);

// 解散
await page.evaluate((id) => {
  document.querySelector('[data-layer-group-remove="' + id + '"]')?.click();
}, groupId);
await sleep(800);
const afterDissolve = await page.evaluate(() => ({
  groups: document.querySelectorAll("[data-layer-group]").length,
  rows: document.querySelectorAll("[data-layer-row]").length
}));
record(
  "解散分组后内容都还在",
  afterDissolve.groups === 0 && afterDissolve.rows === 3,
  "组=" + afterDissolve.groups + " 行=" + afterDissolve.rows
);

await page.evaluate(() => document.querySelector("[data-layer-group-mode]")?.click());
await sleep(400);

// ---------- 3) 拖拽改层序 ----------
const beforeDrag = await rowIds();

// 列表自上而下是顶层到低层，把最后一行（最底层）拖到第一行上方 → 它应该变成顶层
await page.evaluate((ids) => {
  const rows = ids.map((id) => document.querySelector('[data-layer-row="' + id + '"]'));
  const from = rows[rows.length - 1];
  const to = rows[0];
  const dataTransfer = new DataTransfer();
  from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
  const rect = to.getBoundingClientRect();
  const options = {
    bubbles: true,
    cancelable: true,
    dataTransfer,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + 2
  };
  to.dispatchEvent(new DragEvent("dragover", options));
  to.dispatchEvent(new DragEvent("drop", options));
  from.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
}, beforeDrag);
await sleep(900);

const afterDrag = await rowIds();
record(
  "拖拽能把底层的项拖到最顶",
  afterDrag[0] === beforeDrag[beforeDrag.length - 1] && afterDrag.join() !== beforeDrag.join(),
  "拖前顶层=" + beforeDrag[0]?.slice(0, 8) + " 拖后顶层=" + afterDrag[0]?.slice(0, 8)
);

// 再拖回去
await page.evaluate((ids) => {
  const rows = ids.map((id) => document.querySelector('[data-layer-row="' + id + '"]'));
  const from = rows[0];
  const to = rows[rows.length - 1];
  const dataTransfer = new DataTransfer();
  from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
  const rect = to.getBoundingClientRect();
  const options = {
    bubbles: true,
    cancelable: true,
    dataTransfer,
    clientX: rect.left + rect.width / 2,
    clientY: rect.bottom - 2
  };
  to.dispatchEvent(new DragEvent("dragover", options));
  to.dispatchEvent(new DragEvent("drop", options));
  from.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
}, afterDrag);
await sleep(900);

const afterDragBack = await rowIds();
record(
  "往下拖也能改回去",
  afterDragBack[afterDragBack.length - 1] === afterDrag[0],
  "拖后底层=" + afterDragBack[afterDragBack.length - 1]?.slice(0, 8)
);

// 拖拽结果要能撤销。用顶栏的撤销按钮，避免键盘焦点不在画布上导致 Ctrl+Z 落空。
const undoClicked = await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (item) => (item.innerText ?? "").trim() === "撤销" && !item.disabled
  );
  if (!button) return false;
  button.click();
  return true;
});
// 撤销后画面要重排，等它真的变过去再判定，别赌固定等待
let afterUndo = await rowIds();
for (let attempt = 0; attempt < 20; attempt += 1) {
  if (afterUndo.join() !== afterDragBack.join()) {
    break;
  }
  await sleep(200);
  afterUndo = await rowIds();
}
record(
  "拖拽改的层序能撤销",
  undoClicked && afterUndo.join() !== afterDragBack.join(),
  "拖后=" + afterDragBack.map((id) => id.slice(0, 6)).join(",") + " 撤销后=" + afterUndo.map((id) => id.slice(0, 6)).join(",")
);
await page.screenshot({ path: SHOT_DIR + "/layer-drag.png" });

record("全过程没有抛出页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
restoreUploads();

const failed = results.filter((item) => !item.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
