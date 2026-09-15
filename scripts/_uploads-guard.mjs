// 会走「导入图片」的套件都会往 uploads/ 写常驻副本，那是用户的真实素材库。
// 回归 runner 自己有备份还原，但单跑套件时没有，会留下一堆测试图。
// 所以套件开头 guardUploads()、结尾 restoreUploads()，把库整个让出来。
import { copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY = ROOT + "/uploads/已导入图片.json";
const BACKUP = LIBRARY + ".guard-backup";
let armed = false;

export function guardUploads() {
  if (armed) {
    return;
  }
  rmSync(BACKUP, { force: true });
  if (existsSync(LIBRARY)) {
    copyFileSync(LIBRARY, BACKUP);
  }
  rmSync(LIBRARY, { force: true });
  armed = true;
}

export function restoreUploads() {
  if (!armed) {
    return;
  }
  rmSync(LIBRARY, { force: true });
  if (existsSync(BACKUP)) {
    renameSync(BACKUP, LIBRARY);
  }
  armed = false;
}
