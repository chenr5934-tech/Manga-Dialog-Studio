// 全量 e2e 回归 runner。用法：node scripts/_run-regression.mjs
// 结果同时打到 stdout 和 _regression.log。
import { readdirSync, writeFileSync, appendFileSync, copyFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 好几个套件会走「导入图片」流程，而导入现在会往 uploads/ 写常驻副本。
// 不隔离的话跑一轮回归就会往用户的素材库里灌几十张测试图。
const UPLOADS = ROOT + "/uploads/已导入图片.json";
const UPLOADS_BACKUP = ROOT + "/uploads/已导入图片.json.regression-backup";
const hadUploads = existsSync(UPLOADS);
if (hadUploads) {
  copyFileSync(UPLOADS, UPLOADS_BACKUP);
}
const restoreUploads = () => {
  // 跑完先删干净：测试期间各套件写进去的都是测试图。
  // 结束瞬间文件可能还被浏览器句柄占着，删不掉就重试几次。
  for (let attempt = 0; attempt < 5; attempt += 1) {
    rmSync(UPLOADS, { force: true });
    if (!existsSync(UPLOADS)) {
      break;
    }
    // 同步小睡一下再试，避免和刚退出的浏览器进程抢文件句柄
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
  rmSync(UPLOADS, { force: true });
  if (hadUploads && existsSync(UPLOADS_BACKUP)) {
    renameSync(UPLOADS_BACKUP, UPLOADS);
  }
};

const files = readdirSync(ROOT + "/scripts").filter((n) => n.startsWith("e2e-") && n.endsWith(".mjs")).sort();
let passed = 0;
let failed = 0;
writeFileSync(ROOT + "/_regression.log", "");
for (const name of files) {
  const env = { ...process.env };
  if (name === "e2e-export.mjs") env.HEADFUL = "1";
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
restoreUploads();
// e2e-uploads 自己的守卫会把「它开跑前那一刻」的内容还原回去，
// 那份内容也是测试写的，所以最后再清一次
rmSync(UPLOADS, { force: true });
if (!hadUploads) {
  rmSync(UPLOADS_BACKUP, { force: true });
}

appendFileSync(ROOT + "/_regression.log", "TOTAL " + passed + " passed, " + failed + " failed\n");
console.log("TOTAL " + passed + " passed, " + failed + " failed");