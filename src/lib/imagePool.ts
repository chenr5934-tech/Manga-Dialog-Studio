import { hashImage, UploadedImage } from "./uploads";

// 图片池：「已导入图片」栏的数据来源。
//
// 这里就是 uploads/ 里的常驻副本 —— "我导入过的原稿"。
//
// 以前它还会把当前项目里用到的图一并合并进来（整页底图、分镜图、图片层、气泡底图），
// 本意是"删掉页面之后仍然能在栏里找到它"。可那些是画面的组成部分，不是导入的素材：
// 用户一平铺图片、一给气泡换底图，这一栏就凭空多出条目，看起来像编辑器把编辑内容
// 误存成了素材。而原稿在导入那一刻就写进 uploads/ 了，这个合并并没有多保住什么。
//
// id 用图片内容的哈希，不能用列表下标：拿掉一张之后下标整体前移，
// 已经发出去的 id 会全部失效。
export type PooledImage = {
  id: string;
  src: string;
  label: string;
  detail: string;
  naturalWidth?: number;
  naturalHeight?: number;
  // 现在只会是 stored（常驻副本）。字段留着是因为界面上
  // "从列表移除"和"真正删掉"仍然要分开走。
  kind: "stored" | "project";
};

export function collectPooledImages(stored: UploadedImage[] = [], hidden: string[] = []): PooledImage[] {
  const hiddenSet = new Set(hidden);
  const list: PooledImage[] = [];

  for (const item of stored) {
    const value = String(item.image ?? "");
    if (!value) {
      continue;
    }
    // 用户手动移除过的图不再露面
    if (hiddenSet.has(hashImage(value))) {
      continue;
    }
    const size =
      item.naturalWidth && item.naturalHeight ? item.naturalWidth + "×" + item.naturalHeight + " · " : "";
    list.push({
      id: "pool-" + hashImage(value),
      src: value,
      label: item.name,
      detail: size + "已导入",
      naturalWidth: item.naturalWidth,
      naturalHeight: item.naturalHeight,
      kind: "stored"
    });
  }

  return list;
}

export function findPooledImage(
  id: string,
  stored: UploadedImage[] = [],
  hidden: string[] = []
): PooledImage | undefined {
  return collectPooledImages(stored, hidden).find((item) => item.id === id);
}
