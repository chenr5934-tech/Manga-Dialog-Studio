import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

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
await sleep(800);

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

const readRows = () =>
  page.evaluate(() => {
    const header = document.querySelector("header");
    const rows = Array.from(header.children).filter((element) => element.tagName === "DIV").slice(0, 2);
    return rows.map((row) => ({
      overflow: row.scrollWidth - row.clientWidth,
      buttons: Array.from(row.querySelectorAll("button")).map((button) => {
        const box = button.getBoundingClientRect();
        return {
          text: (button.innerText ?? "").trim(),
          height: Math.round(box.height),
          width: Math.round(box.width),
          name: Boolean((button.title ?? "").trim()) || Boolean(button.getAttribute("aria-label"))
        };
      })
    }));
  });

const rows = await readRows();
const topRow = rows[0];
const secondRow = rows[1];
const topLabels = topRow.buttons.map((item) => item.text);
const secondLabels = secondRow.buttons.map((item) => item.text);

record(
  "第一行集中四个高频主操作",
  ["导入图片", "模板", "导出", "Agent 模式"].every((label) => topLabels.includes(label)),
  topLabels.filter(Boolean).join(" / ")
);
record(
  "第一行不再混入低频项目操作",
  !topLabels.includes("另存为") && !topLabels.includes("加载项目") && !topLabels.includes("保存项目"),
  "第一行按钮数=" + topRow.buttons.length
);
record(
  "主操作按钮达到可点尺寸",
  topRow.buttons
    .filter((item) => ["导入图片", "模板", "导出", "Agent 模式"].includes(item.text))
    .every((item) => item.height >= 32 && item.width >= 48),
  topRow.buttons
    .filter((item) => ["导入图片", "模板", "导出", "Agent 模式"].includes(item.text))
    .map((item) => item.text + "=" + item.width + "x" + item.height)
    .join(" ")
);
record(
  "顶栏不产生横向滚动",
  topRow.overflow <= 0 && secondRow.overflow <= 0,
  "第一行溢出=" + topRow.overflow + " 第二行溢出=" + secondRow.overflow
);
record(
  "每个按钮都有可访问名称",
  [...topRow.buttons, ...secondRow.buttons].every((item) => item.text.length > 0 || item.name),
  "无名称按钮=" +
    [...topRow.buttons, ...secondRow.buttons].filter((item) => !item.text && !item.name).length
);

// 已被合并删除的重复入口不应再出现
const bodyText = await page.evaluate(() => document.body.innerText);
const removed = ["新建预设", "+ 椭圆气泡", "手绘分镜", "新增文字", "画布设置"];
record(
  "重复入口已从界面移除",
  removed.every((label) => !bodyText.includes(label)),
  removed.filter((label) => bodyText.includes(label)).join(" / ") || "全部已移除"
);
await page.screenshot({ path: SHOT_DIR + "/ui-toolbar-storyboard.png" });

// 对话编辑模式下第二行应换成气泡工具
await clickByText("对话编辑");
await sleep(600);
const rowsB = await readRows();
const secondB = rowsB[1].buttons.map((item) => item.text);
record(
  "第二行随模式切换上下文工具",
  secondB.includes("+ 圆角气泡") && !secondB.includes("多边形扣选"),
  secondB.filter(Boolean).join(" / ")
);
record("对话编辑下仍不横向滚动", rowsB[1].overflow <= 0, "溢出=" + rowsB[1].overflow);
await page.screenshot({ path: SHOT_DIR + "/ui-toolbar-dialogue.png" });

// 抽屉：画布设置已并入布局；项目文件收在更多里
await clickByText("布局");
await sleep(600);
const drawerText = await page.evaluate(() => {
  const aside = document.querySelector("header aside");
  return aside ? aside.innerText : "";
});
record(
  "画布设置已并入布局抽屉",
  drawerText.includes("画布") && drawerText.includes("应用画布") && drawerText.includes("新建分镜"),
  drawerText.split("\n").filter(Boolean).slice(0, 5).join(" / ")
);
record("布局抽屉内不再出现重复的手绘分镜", !drawerText.includes("手绘分镜"), "");
await page.screenshot({ path: SHOT_DIR + "/ui-drawer-layout.png" });
await clickByText("关闭");
await sleep(500);

await clickByText("更多");
await sleep(600);
const projectDrawer = await page.evaluate(() => {
  const aside = document.querySelector("header aside");
  return aside ? aside.innerText : "";
});
record(
  "低频文件操作收进更多抽屉",
  projectDrawer.includes("另存为") && projectDrawer.includes("加载项目"),
  projectDrawer.split("\n").filter(Boolean).slice(0, 4).join(" / ")
);
await clickByText("关闭");
await sleep(400);

// 左侧栏主入口
const railMain = await page.evaluate(() => {
  const target = Array.from(document.querySelectorAll("button")).find((element) =>
    (element.innerText ?? "").trim() === "导入自定义对话框"
  );
  if (!target) {
    return null;
  }
  const box = target.getBoundingClientRect();
  return { height: Math.round(box.height), width: Math.round(box.width), title: target.title };
});
record(
  "左侧栏提供导入自定义对话框主入口",
  Boolean(railMain) && railMain.width >= 90,
  railMain ? railMain.width + "x" + railMain.height + " " + railMain.title.slice(0, 24) : "未找到"
);

// 删除能力已转到属性面板
await clickByText("+ 圆角气泡");
await sleep(700);
const deleteInInspector = await page.evaluate(() => Boolean(document.querySelector("[data-delete-selection]")));
record("选中对象后属性面板提供删除", deleteInInspector);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
