import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { guardUiConfig, restoreUiConfig } from "./_ui-guard.mjs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? "_shots";

mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  defaultViewport: { width: 1720, height: 1000 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => void dialog.accept());

// 造一张有花纹的壁纸，纯色看不出模糊效果
const assetPage = await browser.newPage();
await assetPage.setViewport({ width: 1200, height: 800 });
const WALLPAPER = SHOT_DIR + "/uitheme-wallpaper.png";
await assetPage.setContent(
  '<!doctype html><body style="margin:0;height:100vh;background:' +
    "repeating-linear-gradient(45deg,#f97316 0 40px,#0ea5e9 40px 80px)" +
    '"></body>'
);
await assetPage.screenshot({ path: WALLPAPER });

// 再备一张"手机照片"级别的大图：2600×1800 满噪点，PNG 妥妥超过 1.5MB，
// 逼着 readWallpaperFile 走压缩分支（照片原样塞进 config 会让每次启动都读几十兆）
const BIG_WALLPAPER = SHOT_DIR + "/uitheme-big-wallpaper.png";
const bigDataUrl = await assetPage.evaluate(() => {
  const width = 2600;
  const height = 1800;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    data[index] = (index * 7) % 255;
    data[index + 1] = (index * 13) % 255;
    data[index + 2] = (index * 29) % 255;
    data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
});
writeFileSync(BIG_WALLPAPER, Buffer.from(bigDataUrl.split(",")[1], "base64"));
await assetPage.close();

const rootVar = (name) =>
  page.evaluate((n) => document.documentElement.style.getPropertyValue(n).trim(), name);
const wallpaperState = () => page.evaluate(() => document.documentElement.dataset.wallpaper ?? "");
const serverConfig = () =>
  page.evaluate(async () => {
    const response = await fetch("/api/ui/config", { cache: "no-store" });
    return response.json();
  });

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

// 真面板有好几层半透明底色，直接量某个元素的 backgroundColor 会量到 transparent。
// 造个探针元素吃 --panel-1，量出来的才是面板真正的颜色。
function probePanel() {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--panel-1)";
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  });
}

function alphaOf(value) {
  const match = String(value).match(/([\d.]+)\)\s*$/);
  return match ? Number(match[1]) : -1;
}

async function setSlider(selector, value) {
  await page.evaluate(
    (sel, val) => {
      const input = document.querySelector(sel);
      if (!input) {
        return;
      }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, String(val));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    selector,
    value
  );
}

try {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
  await sleep(1200);

  // ---- 默认状态 ----
  record("默认没有壁纸", (await wallpaperState()) === "off", "state=" + (await wallpaperState()));
  const initialImage = await page.evaluate(() => {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--ui-wallpaper").trim();
    return value || document.documentElement.style.getPropertyValue("--ui-wallpaper").trim();
  });
  record("默认 --ui-wallpaper 是 none", initialImage === "none" || initialImage === "", "值=" + initialImage);

  const beforePanel = await probePanel();

  // ---- 「更多」抽屉里的界面背景 ----
  await page.click('[data-drawer="project"]');
  await sleep(500);
  const sectionOk = await page.evaluate(() => Boolean(document.querySelector('[data-wallpaper-section="1"]')));
  record("「更多」里有界面背景区块", sectionOk);

  const headingOk = await page.evaluate(() => {
    const section = document.querySelector('[data-wallpaper-section="1"]');
    return Boolean(section && section.innerText.includes("界面背景"));
  });
  record("区块标题是「界面背景」", headingOk);

  const sliders = await page.evaluate(() =>
    ["[data-wallpaper-opacity]", "[data-wallpaper-blur]", "[data-wallpaper-dim]", "[data-panel-opacity]"].map((sel) =>
      Boolean(document.querySelector(sel))
    )
  );
  record(
    "四个调节滑条都在（不透明度/模糊/压暗/面板）",
    sliders.every(Boolean),
    "命中=" + sliders.filter(Boolean).length + "/4"
  );

  const sliderBox = await page.evaluate(() => {
    const input = document.querySelector("[data-wallpaper-opacity]");
    if (!input) {
      return null;
    }
    const rect = input.getBoundingClientRect();
    return { w: Math.round(rect.width), h: Math.round(rect.height) };
  });
  record("滑条有可拖动的实际宽度", Boolean(sliderBox) && sliderBox.w > 180, JSON.stringify(sliderBox));

  const clearDisabledAtStart = await page.evaluate(
    () => document.querySelector("[data-wallpaper-clear]")?.disabled === true
  );
  record("还没设壁纸时「恢复默认背景」是灰的", clearDisabledAtStart);

  // ---- 内置背景（不想自己找图的人的兜底）----
  const presetButtons = await page.evaluate(() => document.querySelectorAll("[data-wallpaper-preset]").length);
  record("提供了几张内置背景", presetButtons >= 4, "数量=" + presetButtons);

  const presetLabel = await page.evaluate(() => {
    const button = document.querySelector('[data-wallpaper-preset="preset:sunset"]');
    return button ? button.getAttribute("aria-label") : null;
  });
  record("内置背景有可读的名字", Boolean(presetLabel), "名字=" + presetLabel);

  const presetChosen = await page.evaluate(() => {
    const button = document.querySelector('[data-wallpaper-preset="preset:sunset"]');
    if (!button) {
      return false;
    }
    button.click();
    return true;
  });
  await sleep(900);
  record("点内置背景后同样进入「有壁纸」状态", presetChosen && (await wallpaperState()) === "on", "state=" + (await wallpaperState()));

  const presetVar = await rootVar("--ui-wallpaper");
  record(
    "内置背景写成渐变而不是图片",
    presetVar.includes("gradient") && !presetVar.startsWith("url("),
    "值=" + presetVar.slice(0, 34)
  );

  const presetPainted = await page.evaluate(() => getComputedStyle(document.documentElement, "::before").backgroundImage);
  record("内置背景真的画在了壁纸层上", presetPainted.includes("gradient"), "前缀=" + presetPainted.slice(0, 34));

  await sleep(700);
  const presetSaved = await serverConfig();
  record("内置背景只记一个短标识，不塞图片数据", presetSaved.wallpaper === "preset:sunset", "值=" + presetSaved.wallpaper);
  record("内置背景不会把文件撑大", JSON.stringify(presetSaved).length < 400, "配置长度=" + JSON.stringify(presetSaved).length);

  // ---- 上传壁纸 ----
  const uploadInput = await page.$("[data-wallpaper-input]");
  record("存在壁纸选择入口", Boolean(uploadInput));
  await uploadInput.uploadFile(WALLPAPER);
  await sleep(1500);

  record("选完壁纸后标记为 on", (await wallpaperState()) === "on", "state=" + (await wallpaperState()));
  const applied = await rootVar("--ui-wallpaper");
  record("壁纸写进了 --ui-wallpaper", applied.startsWith("url(") && applied.includes("data:image"), "前缀=" + applied.slice(0, 24));

  const pseudoBg = await page.evaluate(() => getComputedStyle(document.documentElement, "::before").backgroundImage);
  record("壁纸层真的画上了壁纸", pseudoBg.startsWith("url("), "前缀=" + pseudoBg.slice(0, 24));

  // 以前这里验的是"body 上的网格纹理还在"。现在整页网格已经去掉（它是装饰，
  // 网格只留在画布区），所以改成验更本质的结构：壁纸挂在自己的层上，
  // 没有别的装饰层跟它抢同一个伪元素。
  const layerSplit = await page.evaluate(() => ({
    wallpaperLayer: getComputedStyle(document.documentElement, "::before").backgroundImage.slice(0, 8),
    bodyLayer: getComputedStyle(document.body, "::before").backgroundImage
  }));
  record(
    "壁纸层是独立的，不会被别的装饰层顶掉",
    layerSplit.wallpaperLayer.startsWith("url(") && layerSplit.bodyLayer === "none",
    "壁纸层=" + layerSplit.wallpaperLayer + " body 层=" + layerSplit.bodyLayer
  );

  const pseudoOpacity = await page.evaluate(() => getComputedStyle(document.documentElement, "::before").opacity);
  record("壁纸层按不透明度渲染", pseudoOpacity === "1", "opacity=" + pseudoOpacity);

  const clearEnabled = await page.evaluate(() => document.querySelector("[data-wallpaper-clear]")?.disabled === false);
  record("设好壁纸后「恢复默认背景」可点", clearEnabled);

  // ---- 滑条改参数 ----
  await setSlider("[data-wallpaper-blur]", 18);
  await sleep(400);
  record("模糊滑条写进 --ui-wallpaper-blur", (await rootVar("--ui-wallpaper-blur")) === "18px", "值=" + (await rootVar("--ui-wallpaper-blur")));
  const blurApplied = await page.evaluate(() => getComputedStyle(document.documentElement, "::before").filter);
  record("模糊真的作用在壁纸层", blurApplied.includes("blur(18px)"), "filter=" + blurApplied);

  await setSlider("[data-wallpaper-opacity]", 60);
  await sleep(400);
  record("不透明度滑条生效", (await rootVar("--ui-wallpaper-opacity")) === "0.6", "值=" + (await rootVar("--ui-wallpaper-opacity")));

  await setSlider("[data-wallpaper-dim]", 80);
  await sleep(400);
  record("压暗淡层滑条生效", (await rootVar("--ui-wallpaper-dim")) === "0.8", "值=" + (await rootVar("--ui-wallpaper-dim")));

  await setSlider("[data-panel-opacity]", 70);
  await sleep(400);
  record("面板不透明度滑条生效", (await rootVar("--ui-panel-alpha")) === "0.7", "值=" + (await rootVar("--ui-panel-alpha")));
  const afterPanel = await probePanel();
  record(
    "面板底色跟着变透明",
    alphaOf(beforePanel) > alphaOf(afterPanel) && Math.abs(alphaOf(afterPanel) - 0.7) < 0.02,
    "前=" + beforePanel + " 后=" + afterPanel
  );

  const dimLayer = await page.evaluate(() => getComputedStyle(document.body, "::after").opacity);
  record("压暗层只在有壁纸时显示", dimLayer === "0.8", "opacity=" + dimLayer);

  // ---- 落盘 ----
  await sleep(900);
  const saved = await serverConfig();
  record(
    "参数写进了 config/ui.json",
    saved.wallpaperBlur === 18 && saved.wallpaperOpacity === 60 && saved.wallpaperDim === 80 && saved.panelOpacity === 70,
    JSON.stringify({ b: saved.wallpaperBlur, o: saved.wallpaperOpacity, d: saved.wallpaperDim, p: saved.panelOpacity })
  );
  record("壁纸本体也存下来了", String(saved.wallpaper).startsWith("data:image"), "长度=" + String(saved.wallpaper).length);

  // ---- 大图会被压下来，不会塞爆配置 ----
  await uploadInput.uploadFile(BIG_WALLPAPER);
  await sleep(6000);
  const bigInfo = await page.evaluate(async () => {
    const response = await fetch("/api/ui/config", { cache: "no-store" });
    const config = await response.json();
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("壁纸解不开"));
      image.src = config.wallpaper;
    });
    return {
      head: String(config.wallpaper).slice(0, 22),
      length: String(config.wallpaper).length,
      width: image.naturalWidth,
      height: image.naturalHeight
    };
  });
  record("大图会被转成 JPEG 再存", bigInfo.head.startsWith("data:image/jpeg"), "开头=" + bigInfo.head);
  record(
    "长边被压到 2560 以内",
    Math.max(bigInfo.width, bigInfo.height) <= 2560 && bigInfo.width > 0,
    bigInfo.width + "×" + bigInfo.height
  );
  record("配置不会被一张照片撑爆", bigInfo.length < 4_000_000, "壁纸字符串长度=" + bigInfo.length);

  // ---- 刷新后自动恢复 ----
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
  await sleep(1500);
  record("刷新后壁纸仍在", (await wallpaperState()) === "on", "state=" + (await wallpaperState()));
  record("刷新后模糊参数仍在", (await rootVar("--ui-wallpaper-blur")) === "18px", "值=" + (await rootVar("--ui-wallpaper-blur")));
  record("刷新后面板透明度仍在", (await rootVar("--ui-panel-alpha")) === "0.7", "值=" + (await rootVar("--ui-panel-alpha")));

  // 暗色模式切换不能把壁纸冲掉
  await page.click(".studio-switch");
  await sleep(600);
  const themeNow = await page.evaluate(() => document.documentElement.dataset.theme);
  record("切到暗色后壁纸不丢", (await wallpaperState()) === "on" && themeNow === "dark", "theme=" + themeNow);
  await page.click(".studio-switch");
  await sleep(500);

  // ---- 恢复默认背景 ----
  await page.click('[data-drawer="project"]');
  await sleep(500);
  await page.click("[data-wallpaper-clear]");
  await sleep(1200);
  record("点恢复默认后标记回 off", (await wallpaperState()) === "off", "state=" + (await wallpaperState()));
  const clearedVar = await rootVar("--ui-wallpaper");
  record("恢复默认后不再有背景图", clearedVar === "none", "值=" + clearedVar);
  const clearedPseudo = await page.evaluate(() => getComputedStyle(document.documentElement, "::before").backgroundImage);
  record("恢复默认后壁纸层是空的", clearedPseudo === "none", "值=" + clearedPseudo);
  const cleared = await serverConfig();
  record("config/ui.json 里的壁纸被清掉", cleared.wallpaper === "", "长度=" + String(cleared.wallpaper).length);

  // 壁纸不影响主流程：还能加气泡
  // 右侧默认显示属性面板，图层列表要先切到「画布内容」才会挂载
  const layersTabOk = await page.evaluate(() => {
    const button = document.querySelector("[data-open-layers]");
    if (!button) {
      return false;
    }
    button.click();
    return true;
  });
  await sleep(800);
  const rowsBefore = await page.evaluate(() => document.querySelectorAll("[data-layer-row]").length);
  const presetTabOk = await page.evaluate(() => {
    const tab = document.querySelector('[data-tool="presets"]');
    if (tab) {
      tab.click();
      return true;
    }
    return false;
  });
  await sleep(700);
  const presetCount = await page.evaluate(() => document.querySelectorAll("[data-preset-id]").length);
  await page.evaluate(() => document.querySelector("[data-preset-id]")?.click());
  await sleep(1000);
  const rowsAfter = await page.evaluate(() => document.querySelectorAll("[data-layer-row]").length);
  record(
    "改完界面设定后画布照常能编辑",
    rowsAfter > rowsBefore,
    "图层页=" + layersTabOk + " 预设页=" + presetTabOk + " 预设项=" + presetCount + " 图层行 " + rowsBefore + " -> " + rowsAfter
  );

  record("过程中没有页面异常", errors.length === 0, errors.slice(0, 3).join(" | "));
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
process.exit(failed.length ? 1 : 0);
