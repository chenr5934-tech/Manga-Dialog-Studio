// 界面外观配置（config/ui.json）是用户自己的东西：壁纸和面板透明度。
// 测试会反复改它，单跑套件时必须把现场让出来，跑完再放回去。
import { copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = ROOT + "/config/ui.json";
const BACKUP = CONFIG + ".guard-backup";
let armed = false;

export function guardUiConfig() {
  if (armed) {
    return;
  }
  rmSync(BACKUP, { force: true });
  if (existsSync(CONFIG)) {
    copyFileSync(CONFIG, BACKUP);
  }
  rmSync(CONFIG, { force: true });
  armed = true;
}

export function restoreUiConfig() {
  if (!armed) {
    return;
  }
  rmSync(CONFIG, { force: true });
  if (existsSync(BACKUP)) {
    renameSync(BACKUP, CONFIG);
  }
  armed = false;
}
