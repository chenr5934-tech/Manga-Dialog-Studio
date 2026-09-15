import { Project } from "../types";
import { UploadedImage } from "./uploads";

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
};

export function collectProjectImages(project: Project, stored: UploadedImage[] = []): PooledImage[] {
  const seen = new Set<string>();
  const list: PooledImage[] = [];

  const push = (
    src: string | undefined,
    label: string,
    source: string,
    width?: number,
    height?: number
  ) => {
    const value = String(src ?? "");
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    list.push({
      id: "pool-" + list.length,
      src: value,
      label,
      detail: (width && height ? width + "×" + height + " · " : "") + source,
      naturalWidth: width,
      naturalHeight: height
    });
  };

  // 常驻副本排在最前，导入过的原稿一眼就能找到
  for (const item of stored) {
    push(item.image, item.name, "已导入", item.naturalWidth, item.naturalHeight);
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
  stored: UploadedImage[] = []
): PooledImage | undefined {
  return collectProjectImages(project, stored).find((item) => item.id === id);
}