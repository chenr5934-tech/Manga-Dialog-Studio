import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

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

const toolbox = await page.evaluate(() => {
  const tools = Array.from(document.querySelectorAll("[data-tool]")).map((element) =>
    (element.innerText ?? "").trim()
  );
  const groups = Array.from(document.querySelectorAll("aside p"))
    .map((element) => (element.innerText ?? "").trim())
    .filter((text) => ["扣选", "保存", "辅助"].includes(text));
  const leftPanel = document.querySelector("aside");
  return {
    tools,
    groups,
    overflow: leftPanel ? leftPanel.scrollWidth - leftPanel.clientWidth : -1
  };
});

record(
  "左侧工具栏按用途分成三组",
  toolbox.groups.length === 3,
  toolbox.groups.join(" / ")
);
record(
  "扣选组收齐矩形、多边形、圆形",
  toolbox.tools.includes("矩形") && toolbox.tools.includes("多边形") && toolbox.tools.includes("圆形"),
  toolbox.tools.slice(0, 3).join(" / ")
);
record(
  "保存组放导入图片与导出",
  toolbox.tools.includes("导入图片") && toolbox.tools.includes("导出"),
  toolbox.tools.filter((text) => ["导入图片", "导出"].includes(text)).join(" / ")
);
record(
  "辅助组放 Agent、模板、贴纸、对话框预设",
  ["Agent", "模板", "贴纸", "对话框预设"].every((label) => toolbox.tools.includes(label)),
  toolbox.tools.filter((text) => ["Agent", "模板", "贴纸", "对话框预设"].includes(text)).join(" / ")
);
record("左侧工具栏不产生横向滚动", toolbox.overflow <= 0, "溢出=" + toolbox.overflow);

// 顶部不再重复这些入口
const headerText = await page.evaluate(() => {
  const header = document.querySelector("header");
  return header ? header.innerText : "";
});
record(
  "顶部不再重复左侧已有的按钮",
  !headerText.includes("导入图片") &&
    !headerText.includes("Agent 模式") &&
    !headerText.includes("矩形扣选") &&
    !headerText.includes("多边形扣选"),
  headerText.split("\n").filter(Boolean).slice(0, 6).join(" / ")
);

const contentModeOf = () =>
  page.evaluate(() => document.querySelector("[data-tool-content]")?.getAttribute("data-tool-content") ?? null);
const footerText = () =>
  page.evaluate(() => {
    const content = document.querySelector("[data-tool-content]");
    const footer = content?.parentElement?.querySelector(":scope > div:last-of-type");
    return footer ? footer.innerText : "";
  });

// 默认显示对话框预设，底部是对应的导入入口
record("默认内容区是对话框预设", (await contentModeOf()) === "presets", "模式=" + (await contentModeOf()));
const presetFooter = await footerText();
record(
  "对话框预设下方是「导入自定义对话框」",
  presetFooter.includes("导入自定义对话框"),
  presetFooter.split("\n").filter(Boolean).join(" / ")
);
record(
  "旧的「保存预设 / 预设库」已移除",
  !presetFooter.includes("保存预设") && !presetFooter.includes("预设库"),
  presetFooter.split("\n").filter(Boolean).join(" / ")
);
await page.screenshot({ path: SHOT_DIR + "/toolbox-presets.png" });

// 切到贴纸：内容区与底部入口一起换
await page.click('[data-tool="stickers"]');
await sleep(600);
record("点贴纸后内容区切到贴纸", (await contentModeOf()) === "stickers", "模式=" + (await contentModeOf()));
const stickerGrid = await page.evaluate(() => document.querySelectorAll("[data-sticker-id]").length);
record("贴纸内容区列出贴纸", stickerGrid >= 5, "贴纸数=" + stickerGrid);
const stickerFooter = await footerText();
record(
  "贴纸下方是「导入自定义贴纸」",
  stickerFooter.includes("导入自定义贴纸"),
  stickerFooter.split("\n").filter(Boolean).join(" / ")
);
await page.screenshot({ path: SHOT_DIR + "/toolbox-stickers.png" });

// 切回对话框预设
await page.click('[data-tool="presets"]');
await sleep(500);
record("可以切回对话框预设", (await contentModeOf()) === "presets", "");

// 导出也在这里展开
await page.click('[data-tool="export"]');
await sleep(500);
const exportPanel = await page.evaluate(() => ({
  mode: document.querySelector("[data-tool-content]")?.getAttribute("data-tool-content"),
  hasZip: Boolean(document.querySelector("[data-export-zip]")),
  text: document.querySelector("[data-tool-content]")?.innerText ?? ""
}));
record(
  "点导出后内容区显示三种导出方式",
  exportPanel.mode === "export" &&
    exportPanel.hasZip &&
    exportPanel.text.includes("导出 PNG（当前页）") &&
    exportPanel.text.includes("导出 PDF（全部页）"),
  exportPanel.mode
);

// 圆形扣选可以开启并高亮
await page.click('[data-tool="panel-ellipse"]');
await sleep(500);
const ellipseActive = await page.evaluate(() => {
  const button = document.querySelector('[data-tool="panel-ellipse"]');
  return {
    highlighted: button ? button.className.includes("studio-btn-primary") : false,
    hint: document.body.innerText.includes("圆形扣选已开启")
  };
});
record(
  "圆形扣选可开启并有状态提示",
  ellipseActive.highlighted && ellipseActive.hint,
  "高亮=" + ellipseActive.highlighted + " 提示=" + ellipseActive.hint
);
await clickByText("退出扣选");
await sleep(400);

// 去背景工具在选中带图分镜时可见
const backdropSample = await page.evaluate(() => {
  const canvas = document.querySelector(".studio-workspace canvas");
  if (!canvas) {
    return null;
  }
  const ctx = canvas.getContext("2d");
  const corners = [
    ctx.getImageData(3, 3, 1, 1).data,
    ctx.getImageData(canvas.width - 4, canvas.height - 4, 1, 1).data
  ];
  return corners.every((pixel) => pixel[0] > 250 && pixel[1] > 250 && pixel[2] > 250);
});
record("底层仍是铺满编辑区的白色", backdropSample === true, "四角全白=" + backdropSample);

// 每个面板都得有自己的底色。这条是因为「画布内容」栏曾经用一个
// 样式表里根本没定义的类（studio-panel），面板一直是裸的 —— 页面底色深的时候
// 看不出来，换成浅色壁纸之后文字就直接浮在壁纸上了。这类"类名没定义"的问题
// 靠功能测试很难发现，只能直接从渲染结果上量。
const panelBackdrops = await page.evaluate(() => {
  const alphaOf = (color) => {
    const m = String(color).match(/rgba?\(([^)]+)\)/);
    if (!m) return 0;
    const parts = m[1].split(",").map((v) => Number(v.trim()));
    return parts.length > 3 ? parts[3] : 1;
  };
  const out = [];
  const section = document.querySelector("main > section");
  const columns = section ? Array.from(section.children) : [];
  columns.forEach((cell, index) => {
    const panel = cell.firstElementChild ?? cell;
    const name = String(panel.className).split(/\s+/)[0] || panel.tagName.toLowerCase();
    out.push({ where: "第 " + (index + 1) + " 栏", name: name.slice(0, 34), bg: getComputedStyle(panel).backgroundColor });
  });
  return out.map((item) => ({ ...item, alpha: alphaOf(item.bg) }));
});

const bare = panelBackdrops.filter((item) => item.alpha < 0.5);
record(
  "四栏里的每个面板都有自己的底色",
  panelBackdrops.length >= 4 && bare.length === 0,
  panelBackdrops.map((item) => item.where + "=" + item.name).join(" / ") +
    (bare.length ? "  ← 裸的：" + bare.map((item) => item.where + " " + item.name + " bg=" + item.bg).join("、") : "")
);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
