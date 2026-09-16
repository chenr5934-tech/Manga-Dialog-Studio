import puppeteer from "puppeteer-core";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { guardAgentConfig, restoreAgentConfig } from "./_agent-key-guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const AGENT_CONFIG = ROOT + "/config/agent.json";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

guardAgentConfig();

const KEY_ONE = "sk-remember-me-1111";
const KEY_TWO = "sk-typed-without-saving-2222";

const readAgentFile = () => {
  if (!existsSync(AGENT_CONFIG)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(AGENT_CONFIG, "utf8"));
  } catch {
    return "unparsable";
  }
};

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

async function openAgentPanel() {
  const opened = await page.evaluate(() => {
    const tab = document.querySelector('[data-tool="agent"]');
    if (!tab) {
      return false;
    }
    tab.click();
    return true;
  });
  await sleep(700);
  // 配置区默认是收起的
  const expanded = await page.evaluate(() => {
    const toggle = document.querySelector("[data-agent-config-toggle]");
    if (!toggle) {
      return false;
    }
    if (!document.querySelector("[data-agent-apikey]")) {
      toggle.click();
    }
    return true;
  });
  await sleep(500);
  return opened && expanded;
}

const keyFieldValue = () =>
  page.evaluate(() => {
    const field = document.querySelector("[data-agent-apikey]");
    return field ? field.value : null;
  });

async function fillKey(value) {
  await page.evaluate(
    (next) => {
      const field = document.querySelector("[data-agent-apikey]");
      if (!field) {
        return;
      }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(field, next);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value
  );
  await sleep(300);
}

try {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
  await sleep(1000);

  record("起步时没有遗留的 agent 配置", readAgentFile() === null, JSON.stringify(readAgentFile()).slice(0, 60));

  const panelOk = await openAgentPanel();
  record("能打开 Agent 面板的配置区", panelOk, "结果=" + panelOk);

  const emptyKey = await keyFieldValue();
  record("没配过密钥时输入框是空的", emptyKey === "", "值=" + JSON.stringify(emptyKey));

  // ---- 填密钥并保存 ----
  await fillKey(KEY_ONE);
  await page.click("[data-agent-save]");
  await sleep(1200);

  const savedFile = readAgentFile();
  record(
    "点保存后密钥落到 config/agent.json",
    Boolean(savedFile) && savedFile !== "unparsable" && savedFile.apiKey === KEY_ONE,
    "apiKey=" + (savedFile && savedFile.apiKey ? savedFile.apiKey : String(savedFile))
  );

  const serverKey = await page.evaluate(async () => {
    const response = await fetch("/api/agent/config", { cache: "no-store" });
    const payload = await response.json();
    return payload.apiKey;
  });
  record("接口把已保存的密钥回给前端", serverKey === KEY_ONE, "返回=" + serverKey);

  // ---- 重启（刷新页面）后自动回填 ----
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
  await sleep(1200);
  await openAgentPanel();

  const refilled = await keyFieldValue();
  record("刷新后密钥自动填回来了", refilled === KEY_ONE, "值=" + JSON.stringify(refilled));

  const rememberHint = await page.evaluate(() => {
    const panel = document.querySelector("[data-agent-panel]");
    return panel ? panel.innerText.includes("已记住") : false;
  });
  record("界面上明确写了「已记住，不用再输」", rememberHint);

  const unchangedFile = readAgentFile();
  record(
    "回填不会把文件里的密钥写坏",
    Boolean(unchangedFile) && unchangedFile !== "unparsable" && unchangedFile.apiKey === KEY_ONE,
    "apiKey=" + (unchangedFile && unchangedFile.apiKey ? unchangedFile.apiKey : String(unchangedFile))
  );

  // ---- 只输不点保存，直接发指令 ----
  await fillKey(KEY_TWO);
  const beforeSend = readAgentFile();
  record("换掉密钥但还没保存时文件里仍是旧的", beforeSend && beforeSend.apiKey === KEY_ONE, "apiKey=" + (beforeSend && beforeSend.apiKey));

  await page.click("[data-agent-input]");
  await page.type("[data-agent-input]", "帮我确认一下密钥记住没有", { delay: 8 });
  await page.click("[data-agent-send]");
  await sleep(4000);

  const afterSend = readAgentFile();
  record(
    "直接发指令也会把新密钥落盘",
    Boolean(afterSend) && afterSend !== "unparsable" && afterSend.apiKey === KEY_TWO,
    "apiKey=" + (afterSend && afterSend.apiKey ? afterSend.apiKey : String(afterSend))
  );

  record("过程中没有页面异常", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  restoreAgentConfig();
}

const failed = results.filter((item) => !item.ok);
console.log("");
console.log("通过 " + (results.length - failed.length) + "/" + results.length);
if (failed.length) {
  console.log("失败项：" + failed.map((item) => item.name).join("、"));
}
process.exit(failed.length ? 1 : 0);
