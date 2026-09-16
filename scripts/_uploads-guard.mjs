// 会走「导入图片」的套件都会往 uploads/ 写常驻副本，那是用户的真实素材库。
// 回归 runner 自己有整目录寄存，但单跑套件时没有，会留下一堆测试图。
// 所以套件开头 guardUploads()、结尾 restoreUploads()，把整个库让出来再放回。
import { restoreStashedUploads, stashUploads } from "./_uploads-stash.mjs";

let armed = false;

export function guardUploads() {
  if (armed) {
    return;
  }
  stashUploads();
  armed = true;
}

export function restoreUploads() {
  if (!armed) {
    return;
  }
  restoreStashedUploads();
  armed = false;
}
