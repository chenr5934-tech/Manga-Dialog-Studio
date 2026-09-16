import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RUNNER_STASH,
  SUITE_STASH,
  listUploadFiles,
  restoreStashedUploads,
  stashUploads
} from "./_uploads-stash.mjs";

// 资料库的两层兜底：
// 1) 服务端覆盖/删除之前会自动留一份 <文件>.bak（真丢过一次素材库之后加的）
// 2) 回归与套件开跑前把整个 uploads/ 寄存起来，跑完整体放回
// 这里两层都验，第二层用临时目录，绝不碰用户的真库。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? ROOT + "/_shots";

mkdirSync(SHOT_DIR, { recursive: true });

const NAME = "e2e-备份探针";
const FILE = ROOT + "/uploads/" + NAME + ".json";
const BAK = FILE + ".bak";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

const readIfExists = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);
const cleanup = () => {
  rmSync(FILE, { force: true });
  rmSync(BAK, { force: true });
};

cleanup();

const post = (content) =>
  fetch(API + "api/uploads/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: NAME, content })
  });

const V1 = JSON.stringify({ images: [{ id: "a", image: "data:image/png;base64,AAAA" }], hidden: [] });
const V2 = JSON.stringify({
  images: [
    { id: "a", image: "data:image/png;base64,AAAA" },
    { id: "b", image: "data:image/png;base64,BBBB" }
  ],
  hidden: []
});

try {
  // ---- 第一层：服务端写前留档 ----
  record("起步时没有探针文件", !existsSync(FILE) && !existsSync(BAK));

  const first = await post(V1);
  record("第一次写入成功", first.ok, "状态=" + first.status);
  record("第一次写入不会凭空造备份", !existsSync(BAK), "备份存在=" + existsSync(BAK));

  const second = await post(V2);
  record("第二次写入成功", second.ok, "状态=" + second.status);
  record("第二次写入前存下了上一版", existsSync(BAK), "备份存在=" + existsSync(BAK));
  record("备份内容就是被覆盖的那一版", readIfExists(BAK) === V1, "长度=" + String(readIfExists(BAK)).length);
  record("现有文件是新版", readIfExists(FILE) === V2, "长度=" + String(readIfExists(FILE)).length);

  const listed = await (await fetch(API + "api/uploads")).json();
  const names = (listed.files ?? []).map((item) => item.name);
  record(
    "备份不会被当成一个库列出来",
    names.includes(NAME + ".json") && !names.some((n) => n.endsWith(".bak")),
    "列表=" + names.slice(0, 4).join(",")
  );

  const removed = await fetch(API + "api/uploads/file?name=" + encodeURIComponent(NAME), { method: "DELETE" });
  record("删除请求成功", removed.ok, "状态=" + removed.status);
  record("删除后主文件真的没了", !existsSync(FILE));
  record("删除前自动留了档", existsSync(BAK) && readIfExists(BAK) === V2, "备份长度=" + String(readIfExists(BAK)).length);
} finally {
  cleanup();
}

// ---- 第二层：跑测试前后整目录寄存 ----
const PROBE = join(SHOT_DIR, "stash-probe");
rmSync(PROBE, { recursive: true, force: true });
mkdirSync(PROBE, { recursive: true });
writeFileSync(join(PROBE, "README.md"), "keep me");
writeFileSync(join(PROBE, "已导入图片.json"), "user-library");
writeFileSync(join(PROBE, "已导入图片.json.bak"), "user-backup");

try {
  stashUploads(PROBE);
  record("寄存后目录里没有库文件了", listUploadFiles(PROBE).length === 0, "剩=" + listUploadFiles(PROBE).join(","));
  record("目录说明文件原地不动", existsSync(join(PROBE, "README.md")));

  // 模拟测试期间乱写
  writeFileSync(join(PROBE, "已导入图片.json"), "test-library");
  writeFileSync(join(PROBE, "e2e-垃圾.json"), "junk");
  writeFileSync(join(PROBE, "e2e-垃圾.json.bak"), "junk-backup");
  record("测试期间文件确实写进了目录", listUploadFiles(PROBE).length === 3, "文件数=" + listUploadFiles(PROBE).length);

  restoreStashedUploads(PROBE);
  record("还原后用户主文件回来了", readFileSync(join(PROBE, "已导入图片.json"), "utf8") === "user-library");
  record(
    "用户自己的 .bak 也一并回来了",
    readFileSync(join(PROBE, "已导入图片.json.bak"), "utf8") === "user-backup",
    "内容=" + readFileSync(join(PROBE, "已导入图片.json.bak"), "utf8")
  );
  record("测试写的文件被清干净", !existsSync(join(PROBE, "e2e-垃圾.json")) && !existsSync(join(PROBE, "e2e-垃圾.json.bak")));
  record("寄存目录自己收干净", !existsSync(join(PROBE, ".stash")));
  record("还原后文件数不多不少", listUploadFiles(PROBE).length === 2, "文件数=" + listUploadFiles(PROBE).length);
} finally {
  rmSync(PROBE, { recursive: true, force: true });
}

// ---- 最要紧的一条：没寄存过就调用还原，绝对不能删任何东西 ----
// 上次丢数据就是因为收尾时无条件清空目录。
const NOGUARD = join(SHOT_DIR, "stash-noguard");
rmSync(NOGUARD, { recursive: true, force: true });
mkdirSync(NOGUARD, { recursive: true });
writeFileSync(join(NOGUARD, "已导入图片.json"), "user-library");
try {
  restoreStashedUploads(NOGUARD);
  record(
    "没寄存过就调用还原，用户的文件必须原地不动",
    readIfExists(join(NOGUARD, "已导入图片.json")) === "user-library",
    "内容=" + readIfExists(join(NOGUARD, "已导入图片.json"))
  );
} finally {
  rmSync(NOGUARD, { recursive: true, force: true });
}

// ---- runner 与套件的两层寄存不能互相搬空 ----
const NEST = join(SHOT_DIR, "stash-nest");
rmSync(NEST, { recursive: true, force: true });
mkdirSync(NEST, { recursive: true });
writeFileSync(join(NEST, "已导入图片.json"), "user-library");
try {
  stashUploads(NEST, RUNNER_STASH);
  record("runner 寄存后目录里没有库文件", listUploadFiles(NEST).length === 0);

  stashUploads(NEST, SUITE_STASH);
  writeFileSync(join(NEST, "已导入图片.json"), "test-library");
  writeFileSync(join(NEST, "e2e-垃圾.json"), "junk");
  restoreStashedUploads(NEST, SUITE_STASH);
  record("套件那层还原后测试数据被清掉", !existsSync(join(NEST, "e2e-垃圾.json")));
  record("runner 那层没被套件顺手消费掉", existsSync(join(NEST, RUNNER_STASH)), "寄存目录还在=" + existsSync(join(NEST, RUNNER_STASH)));

  restoreStashedUploads(NEST, RUNNER_STASH);
  record(
    "两层收完，用户的文件回来了",
    readIfExists(join(NEST, "已导入图片.json")) === "user-library",
    "内容=" + readIfExists(join(NEST, "已导入图片.json"))
  );
  record("两个寄存目录都收干净", !existsSync(join(NEST, RUNNER_STASH)) && !existsSync(join(NEST, SUITE_STASH)));
} finally {
  rmSync(NEST, { recursive: true, force: true });
}

const failed = results.filter((item) => !item.ok);
console.log("");
console.log("通过 " + (results.length - failed.length) + "/" + results.length);
if (failed.length) {
  console.log("失败项：" + failed.map((item) => item.name).join("、"));
}
// 这里没有浏览器要关，交给进程自然退出，免得和 keep-alive 连接抢关闭时机
process.exitCode = failed.length ? 1 : 0;
