// 回归 runner 和单跑的套件都会往 uploads/ 写测试图。开跑前把整个 uploads/
// 清空并把原有文件挪到寄存目录里，跑完再整体放回。
//
// 原来是一份份文件复制/还原，只认死一个 "已导入图片.json"：后加的 .bak、
// 以及任何别的临时文件都不在还原范围内，收尾时还会无条件 rmSync 掉刚还原的
// 用户素材库 —— 真的丢过一次数据。整目录搬运没有再漏的缝。
//
// 两层调用会叠在一起（runner 先寄存，套件自己又寄存一次），所以两层的寄存
// 目录名必须分开，否则套件还原时会把 runner 寄存的内容一起搬回并删掉目录，
// runner 收尾再清一次就把用户的文件清没了。
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const UPLOADS_DIR = ROOT + "/uploads";

export const SUITE_STASH = ".stash";
export const RUNNER_STASH = ".stash-runner";

const ALWAYS_KEEP = "README.md";
const isStash = (name) => name === SUITE_STASH || name === RUNNER_STASH;
const isManaged = (name) => name === ALWAYS_KEEP || isStash(name);

export function listUploadFiles(dir = UPLOADS_DIR) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).filter((name) => !isManaged(name));
}

export function stashUploads(dir = UPLOADS_DIR, stashName = SUITE_STASH) {
  mkdirSync(dir, { recursive: true });
  const stashDir = join(dir, stashName);
  mkdirSync(stashDir, { recursive: true });
  for (const name of listUploadFiles(dir)) {
    const target = join(stashDir, name);
    rmSync(target, { recursive: true, force: true });
    renameSync(join(dir, name), target);
  }
}

export function restoreStashedUploads(dir = UPLOADS_DIR, stashName = SUITE_STASH) {
  const stashDir = join(dir, stashName);
  // 没寄存过就没有资格清空目录 —— 这一条是上次丢数据的直接教训
  if (!existsSync(stashDir)) {
    return;
  }
  for (const name of listUploadFiles(dir)) {
    // 测试期间写进来的东西一律清掉，只留被寄存的那批
    rmSync(join(dir, name), { recursive: true, force: true });
  }
  for (const name of readdirSync(stashDir)) {
    const target = join(dir, name);
    rmSync(target, { recursive: true, force: true });
    renameSync(join(stashDir, name), target);
  }
  rmSync(stashDir, { recursive: true, force: true });
}
