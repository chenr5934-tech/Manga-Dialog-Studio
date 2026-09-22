// 全量 e2e 回归 runner。用法：node scripts/_run-regression.mjs
// 结果同时打到 stdout 和 _regression.log。
import { readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RUNNER_STASH,
  UPLOADS_DIR,
  listUploadFiles,
  restoreStashedUploads,
  stashUploads
} from "./_uploads-stash.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 好几个套件会走「导入图片」流程，而导入会往 uploads/ 写常驻副本。
// 不隔离的话跑一轮回归就会往用户的素材库里灌几十张测试图，
// 所以开跑前把整个 uploads/ 寄存起来，跑完整体放回。
// 上一轮如果被中途打断，东西可能还压在寄存目录里没放回去。
// 先还原再记账，否则"跑前有多少"会算成 0，跑完对账就误报。
restoreStashedUploads(UPLOADS_DIR, RUNNER_STASH);

const uploadsBefore = listUploadFiles(UPLOADS_DIR);
// 用 runner 专属的寄存目录名，别和套件自己那层撞车
stashUploads(UPLOADS_DIR, RUNNER_STASH);

const files = readdirSync(ROOT + "/scripts").filter((n) => n.startsWith("e2e-") && n.endsWith(".mjs")).sort();
let passed = 0;
let failed = 0;
writeFileSync(ROOT + "/_regression.log", "");
for (const name of files) {
  const env = { ...process.env };
  if (name === "e2e-export.mjs") env.HEADFUL = "1";
  // 截图一律落在项目内的 _shots/，不往工作区根目录撒
  env.SHOT_DIR = ROOT + "/_shots";
  let out = "";
  try {
    // cwd 必须显式给：套件内部用相对路径读资源
    out = execFileSync(process.execPath, ["scripts/" + name], { encoding: "utf8", env, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    out = String(error.stdout ?? "") + String(error.stderr ?? "");
  }
  // 套件汇总行有两种写法：「结果: 21/21 通过」和「21/21 通过」，取最后一个。
  // e2e-export 不输出汇总行（它打的是 PASS 行 + ZIPPATH），退回按 PASS/FAIL 行数统计。
  const all = [...out.matchAll(/(\d+)\/(\d+) 通过/g)];
  let p = 0;
  let a = 0;
  if (all.length > 0) {
    const parts = all[all.length - 1][0].match(/^(\d+)\/(\d+)/);
    p = Number(parts[1]);
    a = Number(parts[2]);
  } else {
    p = (out.match(/^PASS/gm) ?? []).length;
    a = p + (out.match(/^FAIL/gm) ?? []).length;
  }
  passed += p;
  failed += a - p;
  const fails = out.split("\n").filter((line) => line.startsWith("FAIL")).join("\n");
  appendFileSync(ROOT + "/_regression.log", "=== " + name + " : " + p + "/" + a + " ===\n" + (fails ? fails + "\n" : ""));
  console.log(name + " -> " + p + "/" + a);
}
restoreStashedUploads(UPLOADS_DIR, RUNNER_STASH);

// 跑完对一次账：寄存了多少、还原回来多少，对不上就直接吵出来，
// 不能让素材库再悄无声息地少掉
const uploadsAfter = listUploadFiles(UPLOADS_DIR);
if (uploadsAfter.length !== uploadsBefore.length) {
  console.log("!! uploads/ 还原后文件数对不上：跑前 " + uploadsBefore.length + "，跑后 " + uploadsAfter.length);
  console.log("   跑前的文件：" + (uploadsBefore.join(", ") || "(空)"));
  console.log("   跑后的文件：" + (uploadsAfter.join(", ") || "(空)"));
  process.exitCode = 1;
}

appendFileSync(ROOT + "/_regression.log", "TOTAL " + passed + " passed, " + failed + " failed\n");
console.log("TOTAL " + passed + " passed, " + failed + " failed");