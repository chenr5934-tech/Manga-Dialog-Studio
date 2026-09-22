import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { guardUiConfig, restoreUiConfig } from "./_ui-guard.mjs";

// 动态壁纸：樱花花瓣与水面波光。
// 验的是"这一层只在需要时存在、存在时真的在动、系统要求减少动效时它不动"。
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? "D:/dsh工作区/PROJECTS-项目/MangaDialogStudio/_shots";

mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

guardUiConfig();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1440, height: 900 }
});

// 取三条横线做内容校验和。
// 只数"非透明像素个数"是不够的：水波是线条在移动，总数几乎不变，
// 用数量判断的话，画面完全静止也能通过。
const paintStats = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector("[data-wallpaper-effect]");
    if (!canvas) return null;
    const context = canvas.getContext("2d");
    const width = canvas.width;
    let painted = 0;
    let hash = 7;
    // 20 条扫描线：只取两三条会正好落在波纹之间，量到一片空白
    for (let step = 1; step < 20; step += 1) {
      const y = Math.min(canvas.height - 1, Math.floor((canvas.height * step) / 20));
      const row = context.getImageData(0, y, width, 1).data;
      for (let index = 0; index < row.length; index += 4) {
        if (row[index + 3] > 6) painted += 1;
        hash = (hash * 31 + row[index] * 3 + row[index + 1] * 5 + row[index + 2] * 7 + row[index + 3]) % 2147483647;
      }
    }
    return { painted, hash };
  });

const openDrawer = async (page) => {
  await page.evaluate(() => document.querySelector('[data-drawer="project"]')?.click());
  await sleep(600);
};

const pickPreset = async (page, id) => {
  await page.evaluate((value) => {
    document.querySelector('[data-wallpaper-preset="' + value + '"]')?.click();
  }, id);
  await sleep(1600);
};

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 130)));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
  await sleep(1500);

  await openDrawer(page);

  const presets = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-wallpaper-preset]")).map((el) => el.getAttribute("data-wallpaper-preset"))
  );
  record("内置背景里多了樱花粉与海蓝", presets.includes("preset:sakura") && presets.includes("preset:ocean"), presets.join(", "));

  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-wallpaper-preset]")).map((el) => el.getAttribute("aria-label"))
  );
  record(
    "两张动态背景的名字写明了效果",
    labels.some((t) => String(t).includes("花瓣")) && labels.some((t) => String(t).includes("水")),
    labels.join(" / ")
  );

  // ---- 樱花 ----
  await pickPreset(page, "preset:sakura");
  const sakuraMounted = await page.evaluate(() =>
    document.querySelector('[data-wallpaper-effect="sakura"]') ? true : false
  );
  record("选樱花后挂上了花瓣图层", sakuraMounted);

  const canvasBox = await page.evaluate(() => {
    const canvas = document.querySelector("[data-wallpaper-effect]");
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const s = getComputedStyle(canvas);
    return { w: Math.round(r.width), h: Math.round(r.height), z: s.zIndex, pointer: s.pointerEvents, cover: canvas.width + "x" + canvas.height };
  });
  record(
    "花瓣层铺满视口、不吃鼠标事件、压在内容之下",
    canvasBox && canvasBox.w >= 1430 && canvasBox.h >= 880 && canvasBox.pointer === "none" && canvasBox.z === "-1",
    JSON.stringify(canvasBox)
  );

  const first = await paintStats(page);
  await sleep(1200);
  const second = await paintStats(page);
  record(
    "花瓣真的在飘（两次采样画面不同）",
    first && second && first.painted > 0 && first.hash !== second.hash,
    "首采 hash=" + first?.hash + " → 再采 hash=" + second?.hash + "（着色 " + first?.painted + " px）"
  );

  // ---- 换成静态背景，动效层必须退场 ----
  await pickPreset(page, "preset:sunset");
  const goneAfterSwitch = await page.evaluate(() => !document.querySelector("[data-wallpaper-effect]"));
  record("换成静态背景后动效层被卸掉", goneAfterSwitch);
  const raf = await paintStats(page);
  record("卸掉之后画布不再被绘制", raf === null, raf === null ? "无 canvas" : "仍有 " + raf.painted + " px");

  // ---- 海蓝 ----
  await pickPreset(page, "preset:ocean");
  const oceanMounted = await page.evaluate(() =>
    document.querySelector('[data-wallpaper-effect="waves"]') ? true : false
  );
  record("选海蓝后挂上了水波图层", oceanMounted);
  const waveFirst = await paintStats(page);
  await sleep(1200);
  const waveSecond = await paintStats(page);
  record(
    "水波在动（两次采样画面不同）",
    waveFirst && waveSecond && waveFirst.painted > 0 && waveFirst.hash !== waveSecond.hash,
    "首采 hash=" + waveFirst?.hash + " → 再采 hash=" + waveSecond?.hash + "（着色 " + waveFirst?.painted + " px）"
  );

  const opacityApplied = await page.evaluate(() => {
    const canvas = document.querySelector("[data-wallpaper-effect]");
    return canvas ? Number(getComputedStyle(canvas).opacity) : null;
  });
  record("动效的不透明度跟着壁纸设置走", opacityApplied !== null && opacityApplied <= 1, "opacity=" + opacityApplied);

  record("过程中没有页面异常", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();

  // ---- 系统要求减少动效时不该跑 ----
  const quiet = await browser.newPage();
  await quiet.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await quiet.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await quiet.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
  await sleep(1200);
  await openDrawer(quiet);
  await pickPreset(quiet, "preset:sakura");
  const quietFirst = await paintStats(quiet);
  await sleep(1400);
  const quietSecond = await paintStats(quiet);
  record(
    "系统开了「减少动态效果」时不启动动画",
    quietFirst && quietSecond && quietFirst.painted === 0 && quietSecond.painted === 0,
    "采样 " + (quietFirst?.painted ?? "无") + " / " + (quietSecond?.painted ?? "无") + " px（期望都是 0）"
  );
  await quiet.close();
} finally {
  await browser.close();
  restoreUiConfig();
}

const failed = results.filter((item) => !item.ok);
console.log("");
console.log("通过 " + (results.length - failed.length) + "/" + results.length);
if (failed.length) {
  console.log("失败项：" + failed.map((item) => item.name).join("、"));
}
process.exitCode = failed.length ? 1 : 0;
