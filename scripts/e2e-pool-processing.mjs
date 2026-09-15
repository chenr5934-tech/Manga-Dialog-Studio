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
  "图片缩略图上有「抠图」和「平铺」两个按钮",
  actions.hasBg && actions.hasTile && actions.bgText === "抠图" && actions.tileText === "平铺",
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
  const modal = document.querySelector('[data-tile-modal="1"]');
  if (!modal) {
    return null;
  }
  const preview = modal.querySelector("[data-tile-preview]");
  return {
    open: true,
    cols: modal.querySelector("[data-tile-cols]")?.value ?? "",
    rows: modal.querySelector("[data-tile-rows]")?.value ?? "",
    backgroundSize: preview ? preview.style.backgroundSize : "",
    cropSliders: modal.querySelectorAll("[data-tile-crop]").length
  };
});
record(
  "点「平铺」会打开平铺窗口，并带平铺单元选择",
  Boolean(tileModal?.open) && tileModal.cropSliders === 4,
  "单元选择滑条=" + (tileModal?.cropSliders ?? 0)
);
record(
  "平铺窗口默认按画布比例给出列数行数",
  tileModal?.cols === "3" && tileModal?.rows === "4",
  "列=" + (tileModal?.cols ?? "?") + " 行=" + (tileModal?.rows ?? "?")
);
await page.screenshot({ path: SHOT_DIR + "/pool-tile-modal.png" });

// 改份数，预览的 background-size 应该跟着变小
await setRange("[data-tile-cols]", 2);
await setRange("[data-tile-rows]", 2);
await sleep(400);
const previewAfter = await page.evaluate(() => {
  const preview = document.querySelector("[data-tile-preview]");
  return preview ? preview.style.backgroundSize : "";
});
const cellBefore = Number((tileModal?.backgroundSize ?? "0px").split("px")[0]);
const cellAfter = Number((previewAfter ?? "0px").split("px")[0]);
record(
  "改列数行数会实时更新平铺预览",
  cellAfter > cellBefore && Number.isFinite(cellAfter),
  "3×4 单元宽=" + Math.round(cellBefore) + "px → 2×2 单元宽=" + Math.round(cellAfter) + "px"
);

// 收窄平铺单元，验证裁剪滑条也在起作用
await setRange('[data-tile-crop="w"]', 50);
await sleep(300);
const cropApplied = await page.evaluate(() => {
  const input = document.querySelector('[data-tile-crop="w"]');
  return input ? Number(input.value) : -1;
});
record("平铺单元的选取范围可以自定义调节", cropApplied === 50, "单元宽度=" + cropApplied + "%");

const canvasSize = await readStats();

await page.evaluate(() => document.querySelector('[data-tile-apply="1"]')?.click());
await sleep(2600);
const afterTile = {
  modalGone: await page.evaluate(() => !document.querySelector('[data-tile-modal="1"]')),
  fields: await readPanelFields(),
  green: await colorRatio([34, 197, 94]),
  // 0.5 正好落在两行格子的交界上，那里对应源图 y=0（纯绿）；取第一行格子的中线
  segments: await colorSegments([217, 70, 239], 0.25)
};
record("平铺后窗口自动关闭", afterTile.modalGone);
record(
  "平铺结果按画布尺寸铺满整张画布",
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
  "平铺的图案真的铺到了画布上",
  afterTile.green > 0.5,
  "绿色占画布 " + (afterTile.green * 100).toFixed(1) + "%"
);
record(
  "2 列平铺在画布上形成 2 个重复单元",
  afterTile.segments === 2,
  "水平中线上的洋红段数=" + afterTile.segments + "（期望 2）"
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

const failed = results.filter((item) => !item.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
