import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8737/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1500);

const probe = () => page.evaluate(() => {
  const read = (sel, props) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = s[p];
    return out;
  };
  const surface = read(".studio-surface", ["borderRadius", "borderTopWidth", "borderTopColor", "backgroundColor", "boxShadow"]);
  const btn = read(".studio-btn", ["borderRadius", "borderTopWidth", "borderTopColor", "backgroundImage", "boxShadow"]);
  const input = read(".studio-input", ["borderRadius", "backgroundColor", "boxShadow"]);
  const chip = read(".studio-chip", ["borderRadius"]);
  const pad = document.createElement("div");
  pad.style.backgroundColor = "var(--panel-1)";
  document.body.appendChild(pad);
  const panel1 = getComputedStyle(pad).backgroundColor;
  pad.style.backgroundColor = "var(--panel-2)";
  const panel2 = getComputedStyle(pad).backgroundColor;
  pad.remove();
  return { surface, btn, input, chip, panel1, panel2 };
});
console.log(JSON.stringify(await probe(), null, 1));
await browser.close();
