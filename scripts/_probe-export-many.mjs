import puppeteer from "puppeteer-core";

// 多页导出的压力测试：册子最常见的形态是十来页。
// e2e-export 只覆盖了基础链路，这里专门压页数与倍率。
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1440, height: 900 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 140)));
page.on("dialog", (d) => void d.accept());

await page.evaluateOnNewDocument(() => {
  window.__blobs = {};
  const original = URL.createObjectURL;
  URL.createObjectURL = function (target) {
    if (target instanceof Blob) {
      const kind = target.type.includes("zip") ? "zip" : target.type.includes("pdf") ? "pdf" : null;
      if (kind) {
        window.__blobs[kind] = window.__blobs[kind] ?? [];
        window.__blobs[kind].push(target.size);
      }
    }
    return original.call(this, target);
  };
});

await page.goto("http://127.0.0.1:8737/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1200);

const clickByText = async (label) => {
  for (const handle of await page.$$("button")) {
    const text = await handle.evaluate((el) => (el.innerText ?? "").trim());
    if (text === label) {
      await handle.evaluate((el) => el.click());
      return true;
    }
  }
  return false;
};

const setNumber = async (selector, value) => {
  await page.evaluate((sel, val) => {
    const input = document.querySelector(sel);
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, String(val));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, selector, value);
};

// A4 竖版，加两个气泡让每页都有内容
await page.click('[data-drawer="layout"]');
await sleep(600);
await setNumber("[data-canvas-width]", 2480);
await setNumber("[data-canvas-height]", 3508);
await clickByText("应用画布");
await sleep(900);
await page.keyboard.press("Escape");
await sleep(400);

await page.click('[data-tool="presets"]');
await sleep(500);
await page.evaluate(() => document.querySelectorAll("[data-preset-id]")[0]?.click());
await sleep(700);
await page.evaluate(() => document.querySelectorAll("[data-preset-id]")[2]?.click());
await sleep(700);

const TARGET_PAGES = 10;
for (let index = 1; index < TARGET_PAGES; index += 1) {
  await page.evaluate(() => document.querySelector("[data-page-duplicate]")?.click());
  await sleep(700);
}
const pages = await page.evaluate(() => (document.body.innerText.match(/Page\s*\d+\s*\/\s*(\d+)/) ?? [])[1] ?? "?");
console.log("页数：" + pages + "（A4 2480×3508，每页 2 个气泡）");

// 导出不在抽屉里，是直接摆在第一行的按钮
await clickByText("导出");
await sleep(700);

// ---- ZIP 2x：8.7MP × 4 × 10 页 = 348MP 的渲染量 ----
await clickByText("2x");
await sleep(400);
let started = Date.now();
await page.evaluate(() => document.querySelector("[data-export-zip]")?.click());
let zipDone = null;
for (let attempt = 0; attempt < 180; attempt += 1) {
  await sleep(1000);
  zipDone = await page.evaluate(() => {
    const list = window.__blobs?.zip;
    return list && list.length ? list[list.length - 1] : null;
  });
  if (zipDone) break;
}
const zipMs = Date.now() - started;
console.log("ZIP 2x ：" + (zipDone ? (zipDone / 1048576).toFixed(1) + "MB" : "**没产出来**") + "  用时 " + (zipMs / 1000).toFixed(1) + "s");
const noticeAfterZip = await page.evaluate(() => (document.body.innerText.match(/ZIP[^\n]*|导出[^\n]*/g) ?? []).slice(-2).join(" / "));
console.log("         界面提示：" + noticeAfterZip);

// ---- PDF：把 10 张 2480×3508 塞进一个文件 ----
started = Date.now();
await clickByText("导出 PDF（全部页）");
let pdfDone = null;
for (let attempt = 0; attempt < 240; attempt += 1) {
  await sleep(1000);
  pdfDone = await page.evaluate(() => {
    const list = window.__blobs?.pdf;
    return list && list.length ? list[list.length - 1] : null;
  });
  if (pdfDone) break;
}
const pdfMs = Date.now() - started;
console.log("PDF   ：" + (pdfDone ? (pdfDone / 1048576).toFixed(1) + "MB" : "**没产出来**") + "  用时 " + (pdfMs / 1000).toFixed(1) + "s");

console.log("页面异常：" + (errors.length ? errors.slice(0, 2).join(" | ") : "无"));
await browser.close();
process.exitCode = 0;
