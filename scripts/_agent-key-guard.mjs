// Agent 配置里有用户自己的密钥（config/agent.json）。
// 测试会写假密钥进去，单跑套件时必须先把现场让出来。
import { copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = ROOT + "/config/agent.json";
const BACKUP = CONFIG + ".guard-backup";
let armed = false;

export function guardAgentConfig() {
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

export function restoreAgentConfig() {
  if (!armed) {
    return;
  }
  rmSync(CONFIG, { force: true });
  if (existsSync(BACKUP)) {
    renameSync(BACKUP, CONFIG);
  }
  armed = false;
}
