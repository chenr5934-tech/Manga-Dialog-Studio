import { Project } from "../types";
import { hashImage, UploadedImage } from "./uploads";

// 图片池：左侧「已导入图片」栏的数据来源，由两部分合并而成——
//   1. uploads/ 里的常驻副本（导入过的原稿，删掉页面也不会丢）
//   2. 当前项目里正在用到的图（底图、分镜图、图片层、气泡底图）
// 两边按图片数据去重，同一张只出现一次。
// id 是列表内的序号，拖拽时只传这个短 id，实际图片数据投放时再按 id 取，
// 避免把几 MB 的 dataURL 塞进 dataTransfer。
export type PooledImage = {
  id: string;
  src: string;
  label: string;
  detail: string;
  naturalWidth?: number;
  naturalHeight?: number;
  // stored = uploads/ 里的常驻副本，可以从库里真正删掉；
  // project = 当前项目正在引用的图，只能从列表里移除，动它会破坏画面
  kind: "stored" | "project";
};

export function collectProjectImages(
  project: Project,
  stored: UploadedImage[] = [],
  hidden: string[] = []
): PooledImage[] {
  const seen = new Set<string>();
  const hiddenSet = new Set(hidden);
  const list: PooledImage[] = [];

  const push = (
    src: string | undefined,
    label: string,
    source: string,
    width?: number,
    height?: number,
    kind: "stored" | "project" = "project"
  ) => {
    const value = String(src ?? "");
    if (!value || seen.has(value)) {
      return;
    }
    // 用户手动移除过的图不再露面
    if (hiddenSet.has(hashImage(value))) {
      return;
    }
    seen.add(value);
    list.push({
      // id 用图片内容的哈希，不能用列表下标：
      // 拿掉一张之后下标会整体前移，已经发出去的 id 全部失效
      id: "pool-" + hashImage(value),
      src: value,
      label,
      detail: (width && height ? width + "×" + height + " · " : "") + source,
      naturalWidth: width,
      naturalHeight: height,
      kind
    });
  };

  // 常驻副本排在最前，导入过的原稿一眼就能找到
  for (const item of stored) {
    push(item.image, item.name, "已导入", item.naturalWidth, item.naturalHeight, "stored");
  }

  for (const page of project.pages) {
    if (page.background?.original) {
      push(
        page.background.original,
        page.name + " 底图",
        "整页底图",
        page.background.naturalWidth,
        page.background.naturalHeight
      );
    }

    for (const panel of page.panels) {
      if (panel.image?.original) {
        push(panel.image.original, page.name + " 分镜图", "分镜", panel.image.naturalWidth, panel.image.naturalHeight);
      }
    }

    for (const overlay of page.overlays ?? []) {
      if (overlay.image) {
        push(overlay.image, page.name + " 图片层", "上层", overlay.naturalWidth, overlay.naturalHeight);
      }
    }

    for (const bubble of page.bubbles) {
      if (bubble.image) {
        push(bubble.image, page.name + " 气泡底图", "气泡");
      }
    }
  }

  return list;
}

export function findPooledImage(
  project: Project,
  id: string,
  stored: UploadedImage[] = [],
  hidden: string[] = []
): PooledImage | undefined {
  return collectProjectImages(project, stored, hidden).find((item) => item.id === id);
}