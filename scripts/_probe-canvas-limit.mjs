import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 900 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:8737/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1200);

const setNumber = (selector, value) => page.evaluate((sel, val) => {
  const input = document.querySelector(sel);
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, String(val));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, selector, value);

const clickText = (label) => page.evaluate((text) => {
  const button = Array.from(document.querySelectorAll("button")).find((el) => (el.innerText ?? "").trim() === text);
  if (!button) return false;
  button.click();
  return true;
}, label);

const footer = () => page.evaluate(() => (document.body.innerText.match(/Canvas\s+([\d]+) x ([\d]+)/) ?? []).slice(1).join("×"));
const notice = () => page.evaluate(() => (document.body.innerText.match(/画布尺寸已[^\n]*/) ?? ["（无提示）"])[0]);

const cases = [
  ["99999 × 99999", 99999, 99999],
  ["30000 × 30000", 30000, 30000],
  ["9000 × 12000（合理大尺寸）", 9000, 12000],
  ["2480 × 3508（A4）", 2480, 3508]
];

await page.click('[data-drawer="layout"]');
await sleep(700);

for (const [label, w, h] of cases) {
  await setNumber("[data-canvas-width]", w);
  await setNumber("[data-canvas-height]", h);
  await clickText("应用画布");
  await sleep(900);
  const px = (await footer()).split("×").map(Number);
  const mp = px.length === 2 ? ((px[0] * px[1]) / 1e6).toFixed(1) : "?";
  const size = await footer();
  console.log("  " + label.padEnd(26) + " -> " + size.padEnd(16) + mp + "MP   " + (await notice()));
}

console.log("\n页面异常：" + (errors.length ? errors.slice(0, 2).join(" | ") : "无"));
await browser.close();
process.exitCode = 0;
