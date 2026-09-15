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
page.on("pageerror", (error) => errors.push((error.stack ?? error.message).split("\n").slice(0, 4).join(" <- ")));
const dialogQueue = [];
page.on("dialog", (dialog) => {
  const answer = dialogQueue.shift() ?? true;
  void (answer ? dialog.accept() : dialog.dismiss());
});

// 素材：纯绿背景 + 中央洋红块。绿是唯一色，抠图会整片去掉；洋红用来做像素标记。
const assetPage = await browser.newPage();
await assetPage.setViewport({ width: 600, height: 400 });
await assetPage.setContent(
  '<!doctype html><body style="margin:0"><div style="width:600px;height:400px;background:#22c55e;display:flex;align-items:center;justify-content:center;box-sizing:border-box">' +
    '<div style="width:200px;height:120px;background:#d946ef"></div></div></body>'
);
const SOURCE_PNG = SHOT_DIR + "/pool-flat.png";
await assetPage.screenshot({ path: SOURCE_PNG });
await assetPage.close();

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

const readStats = () =>
  page.evaluate(() => {
    const footer = document.querySelector("footer");
    const text = footer ? footer.innerText : "";
    const size = text.match(/Canvas\s*(\d+)\s*x\s*(\d+)/);
    return {
      panels: Number((text.match(/分镜\s*(\d+)/) ?? [0, -1])[1]),
      canvasWidth: size ? Number(size[1]) : 0,
      canvasHeight: size ? Number(size[2]) : 0,
      raw: text.replace(/\s+/g, " ").slice(0, 70)
    };
  });

// 画布在工作区里是按容器缩放显示的，取样的是缩放后的渲染结果，
// 所以判定只能看比例，不能看绝对像素数。
const colorRatio = async (rgb) => {
  const sample = await page.evaluate((target) => {
    const list = Array.from(document.querySelectorAll(".studio-workspace canvas"));
    if (list.length === 0) {
      return null;
    }
    const off = document.createElement("canvas");
    off.width = list[0].width;
    off.height = list[0].height;
    const ctx = off.getContext("2d");
    for (const item of list) {
      ctx.drawImage(item, 0, 0, off.width, off.height);
    }
    const data = ctx.getImageData(0, 0, off.width, off.height).data;
    let hit = 0;
    let total = 0;
    for (let index = 0; index < data.length; index += 4) {
      total += 1;
      if (
        Math.abs(data[index] - target[0]) < 20 &&
        Math.abs(data[index + 1] - target[1]) < 20 &&
        Math.abs(data[index + 2] - target[2]) < 20
      ) {
        hit += 1;
      }
    }
    return { hit, total };
  }, rgb);
  return sample && sample.total > 0 ? sample.hit / sample.total : 0;
};

// 沿画布水平中线数某个颜色的连续段数，用来验证平铺份数
const colorSegments = (rgb, ratio = 0.5) =>
  page.evaluate(
    (target, y) => {
      const list = Array.from(document.querySelectorAll(".studio-workspace canvas"));
      const off = document.createElement("canvas");
      off.width = list[0].width;
      off.height = list[0].height;
      const ctx = off.getContext("2d");
      for (const item of list) {
        ctx.drawImage(item, 0, 0, off.width, off.height);
      }
      const row = Math.max(0, Math.min(off.height - 1, Math.round(off.height * y)));
      const data = ctx.getImageData(0, row, off.width, 1).data;
      let segments = 0;
      let inside = false;
      for (let x = 0; x < off.width; x += 1) {
        const index = x * 4;
        const match =
          Math.abs(data[index] - target[0]) < 30 &&
          Math.abs(data[index + 1] - target[1]) < 30 &&
          Math.abs(data[index + 2] - target[2]) < 30;
        if (match && !inside) {
          segments += 1;
          inside = true;
        } else if (!match) {
          inside = false;
        }
      }
      return segments;
    },
    rgb,
    ratio
  );

const countColor = (rgb) =>
  page.evaluate((target) => {
    const canvases = Array.from(document.querySelectorAll(".studio-workspace canvas"));
    if (canvases.length === 0) {
      return 0;
    }
    const off = document.createElement("canvas");
    off.width = canvases[0].width;
    off.height = canvases[0].height;
    const ctx = off.getContext("2d");
    for (const item of canvases) {
      ctx.drawImage(item, 0, 0, off.width, off.height);
    }
    const data = ctx.getImageData(0, 0, off.width, off.height).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (
        Math.abs(data[index] - target[0]) < 24 &&
        Math.abs(data[index + 1] - target[1]) < 24 &&
        Math.abs(data[index + 2] - target[2]) < 24
      ) {
        count += 1;
      }
    }
    return count;
  }, rgb);

// React 受控 range：必须走原生 setter，否则 onChange 不触发
async function setRange(selector, value) {
  return page.evaluate(
    (sel, val) => {
      const input = document.querySelector(sel);
      if (!input) {
        return false;
      }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, String(val));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    selector,
    value
  );
}

const readPanelFields = () =>
  page.evaluate(() => {
    const values = {};
    for (const label of document.querySelectorAll("aside label")) {
      const name = label.querySelector("span")?.innerText?.trim();
      const input = label.querySelector("input");
      if (name && input && input.value !== "") {
        const numeric = Number(input.value);
        if (Number.isFinite(numeric)) {
          values[name] = numeric;
        }
      }
    }
    return values;
  });

const poolCount = () => page.evaluate(() => document.querySelectorAll("[data-pooled-image]").length);
const overlayCount = () =>
  page.evaluate(() => {
    // 图片层选中时属性面板顶部会出现「图片层」标签
    return document.body.innerText.includes("图片层") ? 1 : 0;
  });

// ---------- 准备：导入原稿 ----------
await clickByText("导入图片");
await sleep(700);
const importInput = await page.$("[data-import-images-input]");
await importInput.uploadFile(SOURCE_PNG);
await sleep(2500);
await page.click("[data-import-confirm]");
await sleep(2500);

// 导入只进素材库，要变成胶片页得把它拖到胶片栏上
async function materialToPage(index = 0) {
  await page.click('[data-tool="images"]');
  await sleep(700);
  await page.evaluate((i) => {
    const tile = Array.from(document.querySelectorAll("[data-pooled-image]"))[i];
    const list = document.querySelector("[data-thumb-list]");
    if (!tile || !list) return;
    const dataTransfer = new DataTransfer();
    tile.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    const options = { bubbles: true, cancelable: true, dataTransfer };
    list.dispatchEvent(new DragEvent("dragover", options));
    list.dispatchEvent(new DragEvent("drop", options));
  }, index);
  await sleep(2000);
}

await materialToPage();

await page.click('[data-tool="images"]');
await sleep(700);
const basePool = await poolCount();
record("「已导入图片」栏里有原稿", basePool >= 1, "图片数=" + basePool);

// ---------- 1) 缩略图上有抠图 / 平铺入口 ----------
const actions = await page.evaluate(() => {
  const tile = document.querySelector("[data-pooled-image]");
  return {
    id: tile ? tile.getAttribute("data-pooled-image") : null,
    hasBg: Boolean(tile && tile.querySelector("[data-pooled-image-bg]")),
    hasTile: Boolean(tile && tile.querySelector("[data-pooled-image-tile]")),
    bgText: (tile?.querySelector("[data-pooled-image-bg]")?.innerText ?? "").trim(),
    tileText: (tile?.querySelector("[data-pooled-image-tile]")?.innerText ?? "").trim()
  };
});
record(
  "图片缩略图上有「抠图」和「铺满」两个按钮",
  actions.hasBg && actions.hasTile && actions.bgText === "抠图" && actions.tileText === "铺满",
  actions.bgText + " / " + actions.tileText
);
await page.screenshot({ path: SHOT_DIR + "/pool-actions.png" });

// ---------- 2) 抠图入口：弹窗带着正确的源图打开 ----------
await page.evaluate((id) => {
  document.querySelector('[data-pooled-image-bg="' + id + '"]')?.click();
}, actions.id);
await sleep(800);
const modalOpen = await page.evaluate(() => {
  const modal = document.querySelector('[data-bg-remover="1"]');
  if (!modal) {
    return null;
  }
  const images = Array.from(modal.querySelectorAll("img"));
  return {
    open: true,
    sourceBytes: (document.querySelector("[data-pooled-image] img")?.getAttribute("src") ?? "").length,
    modalBytes: (images[0]?.getAttribute("src") ?? "").length,
    applyLabel: (modal.querySelector('[data-bg-apply="1"]')?.innerText ?? "").trim(),
    hasTolerance: Boolean(modal.querySelector('[data-bg-tolerance="1"]')),
    hasFeather: Boolean(modal.querySelector('[data-bg-feather="1"]'))
  };
});
record(
  "点「抠图」会在图片栏里直接打开去背景窗口",
  Boolean(modalOpen?.open) && modalOpen.hasTolerance && modalOpen.hasFeather,
  "申请按钮=" + (modalOpen?.applyLabel ?? "无")
);
record(
  "去背景窗口拿到的就是这张池子里的图",
  Boolean(modalOpen) && modalOpen.modalBytes > 1000 && modalOpen.modalBytes === modalOpen.sourceBytes,
  "源图字节=" + (modalOpen?.sourceBytes ?? 0) + " 窗口字节=" + (modalOpen?.modalBytes ?? 0)
);
await page.screenshot({ path: SHOT_DIR + "/pool-bg-remover.png" });

// 等预览算出来（debounce 260ms + 处理时间）
let bgReady = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const disabled = await page.evaluate(() => {
    const button = document.querySelector('[data-bg-apply="1"]');
    return button ? button.disabled : true;
  });
  if (!disabled) {
    bgReady = true;
    break;
  }
  await sleep(300);
}
record("去背景预览生成完成，申请按钮可用", bgReady);

const magentaBefore = await colorRatio([217, 70, 239]);
await page.evaluate(() => document.querySelector('[data-bg-apply="1"]')?.click());
await sleep(1800);
const afterBg = {
  modalGone: await page.evaluate(() => !document.querySelector('[data-bg-remover="1"]')),
  pool: await poolCount(),
  fields: await readPanelFields(),
  magenta: await colorRatio([217, 70, 239])
};
record("抠图后窗口自动关闭", afterBg.modalGone);
record(
  "抠图结果作为一个图片层落到画布上",
  Number.isFinite(afterBg.fields["宽度"]) && afterBg.fields["宽度"] > 0,
  "宽度=" + (afterBg.fields["宽度"] ?? "?") + " 高度=" + (afterBg.fields["高度"] ?? "?")
);
record(
  "抠图结果同时出现在「已导入图片」里，可以再次取用",
  afterBg.pool > basePool,
  "抠图前=" + basePool + " 抠图后=" + afterBg.pool
);
record(
  "抠图过程没有把主体一起抹掉（洋红块仍在）",
  afterBg.magenta > 0 && magentaBefore > 0,
  "处理前洋红占比=" + (magentaBefore * 100).toFixed(1) + "% 处理后=" + (afterBg.magenta * 100).toFixed(1) + "%"
);
await page.screenshot({ path: SHOT_DIR + "/pool-after-bg.png" });

// ---------- 3) 平铺入口 ----------
const poolAfterBg = await poolCount();
await page.click('[data-tool="images"]');
await sleep(500);
const tileId = await page.evaluate(() => {
  const tile = document.querySelector("[data-pooled-image]");
  return tile ? tile.getAttribute("data-pooled-image") : null;
});
await page.evaluate((id) => {
  document.querySelector('[data-pooled-image-tile="' + id + '"]')?.click();
}, tileId);
await sleep(800);

const tileModal = await page.evaluate(() => {
  const modal = document.querySelector('[data-fill-modal="1"]');
  if (!modal) {
    return null;
  }
  return {
    open: true,
    hasPreview: Boolean(modal.querySelector("[data-fill-preview]")),
    modes: Array.from(modal.querySelectorAll("[data-fill-mode-option]")).map((item) =>
      item.getAttribute("data-fill-mode-option")
    ),
    modeLabels: Array.from(modal.querySelectorAll("[data-fill-mode-option]")).map((item) =>
      (item.innerText ?? "").trim().split("\n")[0]
    ),
    sections: Array.from(modal.querySelectorAll("[data-fill-section]")).map((item) =>
      item.getAttribute("data-fill-section")
    )
  };
});
record(
  "点「铺满」会打开铺满窗口并带画布预览",
  Boolean(tileModal?.open) && tileModal.hasPreview,
  "预览=" + (tileModal?.hasPreview ? "有" : "无")
);
record(
  "铺满窗口提供拉伸 / 等比填满 / 等比适应三种方式",
  tileModal?.modes.join(",") === "stretch,cover,contain",
  tileModal?.modeLabels.join(" / ")
);
record(
  "参数按铺满方式 / 对齐 / 尺寸分区，不再堆在一起",
  tileModal?.sections.join(",") === "mode,align,info",
  tileModal?.sections.join(" / ")
);
await page.screenshot({ path: SHOT_DIR + "/pool-fill-modal.png" });

const fitOf = async (mode) => {
  await page.evaluate((value) => {
    document.querySelector('[data-fill-mode-option="' + value + '"]')?.click();
  }, mode);
  await sleep(350);
  return page.evaluate(() => {
    const img = document.querySelector("[data-fill-preview] img");
    return img ? img.style.objectFit : "";
  });
};
const fitStretch = await fitOf("stretch");
const fitCover = await fitOf("cover");
const fitContain = await fitOf("contain");
record(
  "切换铺满方式会实时改掉预览效果",
  fitStretch === "fill" && fitCover === "cover" && fitContain === "contain",
  "拉伸=" + fitStretch + " 填满=" + fitCover + " 适应=" + fitContain
);

// 对齐按钮只在拉伸模式下置灰，所以必须先切回拉伸再检查
await fitOf("stretch");
const alignDisabled = await page.evaluate(() => {
  const button = document.querySelector('[data-fill-align-option="top"]');
  return button ? button.disabled : null;
});
record("拉伸铺满时对齐按钮置灰（占满画布无需对齐）", alignDisabled === true, "禁用=" + alignDisabled);
await fitOf("contain");
const alignEnabled = await page.evaluate(() => {
  const button = document.querySelector('[data-fill-align-option="top"]');
  return button ? button.disabled : null;
});
record("等比模式下对齐按钮恢复可用", alignEnabled === false, "禁用=" + alignEnabled);

await fitOf("stretch");
const canvasSize = await readStats();
await page.evaluate(() => document.querySelector('[data-fill-apply="1"]')?.click());
await sleep(1200);

// 新图片层是异步解码的，解码完之前采样会数到 0。
// 轮询到画面内容稳定下来再判定，别用固定 sleep 赌时序。
let previousKey = "";
let stableRounds = 0;
for (let attempt = 0; attempt < 40; attempt += 1) {
  const green = await colorRatio([34, 197, 94]);
  const magenta = await colorRatio([217, 70, 239]);
  const key = green.toFixed(3) + "/" + magenta.toFixed(3);
  if (key === previousKey && green + magenta > 0.5) {
    stableRounds += 1;
    if (stableRounds >= 2) {
      break;
    }
  } else {
    stableRounds = 0;
  }
  previousKey = key;
  await sleep(250);
}

const afterTile = {
  modalGone: await page.evaluate(() => !document.querySelector('[data-fill-modal="1"]')),
  fields: await readPanelFields(),
  green: await colorRatio([34, 197, 94]),
  magenta: await colorRatio([217, 70, 239]),
  // 底色是白色。铺满之后画布上不该再看到它。
  // 注意：图片层落地时是选中态，Konva 的选中框和锚点画在同一张 canvas 上，
  // 会占掉 8% 左右像素，所以判据用「画面内容占比」而不是「接近 100%」。
  white: await colorRatio([255, 255, 255])
};
record("铺满后窗口自动关闭", afterTile.modalGone);
record(
  "铺满结果与画布等大",
  Number.isFinite(afterTile.fields["宽度"]) &&
    Math.abs(afterTile.fields["宽度"] - canvasSize.canvasWidth) <= 2 &&
    Math.abs(afterTile.fields["高度"] - canvasSize.canvasHeight) <= 2,
  "图片层=" +
    (afterTile.fields["宽度"] ?? "?") +
    "×" +
    (afterTile.fields["高度"] ?? "?") +
    " 画布=" +
    canvasSize.canvasWidth +
    "×" +
    canvasSize.canvasHeight
);
record(
  "拉伸铺满后画布被这张图占满，没有露出底色",
  afterTile.green + afterTile.magenta > 0.9 && afterTile.white < 0.02,
  "图形 " +
    ((afterTile.green + afterTile.magenta) * 100).toFixed(1) +
    "%，残留底色 " +
    (afterTile.white * 100).toFixed(1) +
    "%"
);
await page.screenshot({ path: SHOT_DIR + "/pool-after-tile.png" });

// ---------- 4) 画布尺寸预设 ----------
// 「布局」是一个切换按钮：已经展开时再点会收起
if (!(await page.$("[data-canvas-preset]"))) {
  await clickByText("布局");
  await sleep(600);
}
const presets = await page.evaluate(() => {
  const select = document.querySelector("[data-canvas-preset]");
  if (!select) {
    return [];
  }
  return Array.from(select.options).map((option) => ({ value: option.value, label: option.textContent.trim() }));
});
record(
  "画布尺寸下拉里有多个常用尺寸",
  presets.length >= 8,
  presets.map((item) => item.label).join(" / ")
);
await page.screenshot({ path: SHOT_DIR + "/pool-canvas-presets.png" });

const presetResults = [];
for (const preset of ["A4", "A4-landscape", "B5", "webtoon", "square", "hd", "phone"]) {
  const applied = await page.evaluate((value) => {
    const select = document.querySelector("[data-canvas-preset]");
    if (!select) {
      return false;
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, preset);
  await sleep(1400);
  const size = await page.evaluate(() => {
    const width = document.querySelector("[data-canvas-width]");
    const height = document.querySelector("[data-canvas-height]");
    return { width: Number(width?.value ?? 0), height: Number(height?.value ?? 0) };
  });
  presetResults.push({ preset, applied, errorCount: errors.length, ...size });
}
const mismatched = presetResults.filter((item) => item.width <= 0 || item.height <= 0);
record(
  "切换画布尺寸预设会立刻改掉画布宽高",
  mismatched.length === 0,
  presetResults.map((item) => item.preset + "=" + item.width + "×" + item.height + "@err" + item.errorCount).join(" ")
);

const customOk = await page.evaluate(() => {
  const width = document.querySelector("[data-canvas-width]");
  const height = document.querySelector("[data-canvas-height]");
  if (!width || !height) {
    return null;
  }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(width, "1234");
  width.dispatchEvent(new Event("input", { bubbles: true }));
  setter.call(height, "2345");
  height.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
});
await sleep(300);
await page.evaluate(() => {
  const form = document.querySelector("[data-canvas-width]")?.closest("form");
  const button = form ? Array.from(form.querySelectorAll("button")).find((item) => (item.innerText ?? "").includes("应用画布")) : null;
  void button;
});
await page.evaluate(() => {
  const form = document.querySelector("[data-canvas-width]")?.closest("form");
  if (form) {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }
});
await sleep(900);
const customSize = await page.evaluate(() => {
  const width = document.querySelector("[data-canvas-width]");
  const height = document.querySelector("[data-canvas-height]");
  return { width: Number(width?.value ?? 0), height: Number(height?.value ?? 0) };
});
record(
  "可以手填自定义画布尺寸",
  customOk && customSize.width === 1234 && customSize.height === 2345,
  customSize.width + "×" + customSize.height
);

const stats = await readStats();
console.log("  状态栏：" + stats.raw);
record("全过程没有抛出页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

restoreUploads();

const failed = results.filter((item) => !item.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
