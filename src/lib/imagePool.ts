import { Project } from "../types";

// 图片池：把项目里出现过的图片去重后列出来，供左侧「已导入图片」栏使用。
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

export function collectProjectImages(project: Project): PooledImage[] {
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

export function findPooledImage(project: Project, id: string): PooledImage | undefined {
  return collectProjectImages(project).find((item) => item.id === id);
}