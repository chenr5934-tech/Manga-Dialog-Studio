import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { guardUploads, restoreUploads } from "./_uploads-guard.mjs";

// 「一次导入十几张图就报错」的回归。
// 原来导入是整份库全量回写：老库有多大，每次导入就要连带传多大，
// 装满十几张原稿后单请求超过服务端上限，而超限时服务端直接 destroy 连接，
// 前端只能拿到一句 fetch failed —— 用户看到的就是"报错"。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const NAME = "e2e-体积探针";
const FILE = ROOT + "/uploads/" + NAME + ".json";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

guardUploads();
rmSync(FILE, { force: true });

// 造指定体积的假图：base64 里 1 字符 ≈ 0.75 字节
const makeImage = (bytes, tag) =>
  "data:image/png;base64," + tag + "A".repeat(Math.max(0, Math.floor(bytes / 0.75) - tag.length));

const makeItems = (count, perImageBytes, from = 0) =>
  Array.from({ length: count }, (_, index) => ({
    id: "probe-" + (from + index),
    name: "探针图 " + (from + index),
    image: makeImage(perImageBytes, "IMG" + (from + index) + "|"),
    naturalWidth: 1200,
    naturalHeight: 800,
    addedAt: Date.now()
  }));

const post = async (path, body) => {
  const size = Buffer.byteLength(body);
  const started = Date.now();
  try {
    const response = await fetch(API + "api/uploads" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: response.status, parsed, ms: Date.now() - started, mb: (size / 1048576).toFixed(1), threw: false };
  } catch (error) {
    return { status: 0, parsed: null, ms: Date.now() - started, mb: (size / 1048576).toFixed(1), threw: true, message: error.message };
  }
};

const readLibrary = () => {
  if (!existsSync(FILE)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return null;
  }
};

try {
  // ---- 增量追加 ----
  const first = await post("/append", JSON.stringify({ name: NAME, items: makeItems(12, 2 * 1024 * 1024) }));
  record("追加 12 张原稿成功", first.status === 200, "请求 " + first.mb + "MB → HTTP " + first.status + " (" + first.ms + "ms)");
  const afterFirst = readLibrary();
  record("磁盘上的库确实是 12 张", afterFirst?.images?.length === 12, "实际=" + (afterFirst?.images?.length ?? "无文件"));

  // 关键对比：第二次追加的请求体只跟"这批新增"有关，不随库一起长大
  const second = await post("/append", JSON.stringify({ name: NAME, items: makeItems(12, 2 * 1024 * 1024, 12) }));
  record("再加 12 张仍然成功", second.status === 200, "请求 " + second.mb + "MB → HTTP " + second.status);
  const afterSecond = readLibrary();
  record("第二次追加是在原库基础上合并", afterSecond?.images?.length === 24, "总数=" + (afterSecond?.images?.length ?? "无"));
  // 关键是"没把老库背上"，不是"请求小"：12 张新图本身就有 32MB，
  // 全量写法还要再把已有那 12 张一起传一遍，约 64MB
  record(
    "第二次请求体只含新图，没把老库背上",
    Number(second.mb) < 48,
    "本次 " + second.mb + "MB；带上已有 " + (afterFirst?.images?.length ?? 0) + " 张会是约 64MB"
  );

  // 重复图不该被存两遍
  const again = await post("/append", JSON.stringify({ name: NAME, items: makeItems(3, 2 * 1024 * 1024) }));
  record("重复追加同一批图会被去重", again.status === 200 && readLibrary()?.images?.length === 24, "总数=" + readLibrary()?.images?.length);

  // ---- hidden 单独写，不背图片数据 ----
  const hiddenWrite = await post("/append", JSON.stringify({ name: NAME, hidden: ["h1", "h2"] }));
  record("隐藏记录可以单独写", hiddenWrite.status === 200 && readLibrary()?.hidden?.length === 2, "请求 " + hiddenWrite.mb + "MB → hidden=" + JSON.stringify(readLibrary()?.hidden));
  record("写 hidden 时没有重复传图片", Number(hiddenWrite.mb) < 0.01, "请求体 " + hiddenWrite.mb + "MB");

  // ---- 一次导入几十张：前端按体积切批，每批都远低于上限 ----
  // 这条模拟前端 appendUploadedImages 的切批：60MB 分成 3 批发，
  // 每批都是独立增量追加，最终库是 25 + 30 = 55 张。
  const manyItems = makeItems(30, 2 * 1024 * 1024, 200);
  const batchSize = 10;
  let batchOk = true;
  let batchMax = 0;
  for (let offset = 0; offset < manyItems.length; offset += batchSize) {
    const slice = manyItems.slice(offset, offset + batchSize);
    const sent = await post("/append", JSON.stringify({ name: NAME, items: slice }));
    batchMax = Math.max(batchMax, Number(sent.mb));
    if (sent.status !== 200) {
      batchOk = false;
    }
  }
  const afterBatches = readLibrary();
  // 此处按 10 张一封模拟前端的切批节奏（前端按 24MB 累计切），
  // 验的是"连续多批追加都能落库且互不覆盖"，不是重算一遍切批算法
  record(
    "一次导入几十张连发多批也都能成功",
    batchOk && afterBatches?.images?.length === 54,
    "共 " + Math.ceil(manyItems.length / batchSize) + " 批，最大单批 " + batchMax.toFixed(1) + "MB，总数=" + (afterBatches?.images?.length ?? "无")
  );

  // ---- 超限时给能读懂的错误，而不是掐断连接 ----
  const huge = await post("/file", JSON.stringify({ name: NAME, content: JSON.stringify({ images: makeItems(40, 3 * 1024 * 1024), hidden: [] }) }));
  record(
    "超过上限时返回可读的 413 而不是断开连接",
    huge.status === 413 && Boolean(huge.parsed?.error),
    "请求 " + huge.mb + "MB → HTTP " + huge.status + (huge.threw ? "（客户端异常：" + huge.message + "）" : " " + JSON.stringify(huge.parsed))
  );
  record("超限报错里带上了上限数字", String(huge.parsed?.error ?? "").includes("MB"), "提示=" + String(huge.parsed?.error ?? "无"));

  // 失败之后服务没被搞坏
  const after = await post("/append", JSON.stringify({ name: NAME, items: makeItems(1, 64 * 1024, 900) }));
  record("一次超限之后服务仍然可用", after.status === 200 && readLibrary()?.images?.length === 55, "总数=" + readLibrary()?.images?.length);
} finally {
  rmSync(FILE, { force: true });
  rmSync(FILE + ".bak", { force: true });
  restoreUploads();
}

const failed = results.filter((item) => !item.ok);
console.log("");
console.log("通过 " + (results.length - failed.length) + "/" + results.length);
if (failed.length) {
  console.log("失败项：" + failed.map((item) => item.name).join("、"));
}
process.exitCode = failed.length ? 1 : 0;
