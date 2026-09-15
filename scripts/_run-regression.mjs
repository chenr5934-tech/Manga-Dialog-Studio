// 全量 e2e 回归 runner。用法：node scripts/_run-regression.mjs
// 结果同时打到 stdout 和 _regression.log。
import { readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
appendFileSync(ROOT + "/_regression.log", "TOTAL " + passed + " passed, " + failed + " failed\n");
console.log("TOTAL " + passed + " passed, " + failed + " failed");