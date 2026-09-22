import { v4 as uuidv4 } from "uuid";

// 已导入图片库：把「导入图片」进来的原稿在 uploads/ 里留一份常驻副本。
// 左侧「已导入图片」栏同时展示这份副本和当前项目里用到的图，
// 所以就算画布上的页面、分镜或图片层被删掉，原稿也不会跟着消失。
export type UploadedImage = {
  id: string;
  name: string;
  image: string;
  naturalWidth: number;
  naturalHeight: number;
  addedAt: number;
};

const LIBRARY_NAME = "已导入图片";

// 图片数据的短标识：dataURL 有几 MB，不能拿原串当 key 存进库文件
export function hashImage(src: string): string {
  let hash = 5381;
  for (let index = 0; index < src.length; index += 1) {
    hash = ((hash << 5) + hash + src.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36) + "-" + src.length.toString(36);
}

// 库文件的完整形态：常驻图片 + 用户手动从列表里移除过的图
export type UploadLibrary = {
  images: UploadedImage[];
  hidden: string[];
};

export function normalizeHidden(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : Array.isArray((input as { hidden?: unknown })?.hidden)
      ? (input as { hidden: unknown[] }).hidden
      : [];
  return raw.map((item) => String(item)).filter(Boolean);
}

export function normalizeUploadedImages(input: unknown): UploadedImage[] {
  const list = Array.isArray(input)
    ? input
    : Array.isArray((input as { images?: unknown })?.images)
      ? (input as { images: unknown[] }).images
      : [];

  const out: UploadedImage[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const item = raw as Partial<UploadedImage>;
    const image = String(item.image ?? "");
    if (!image) {
      continue;
    }
    out.push({
      id: String(item.id ?? "upload-" + uuidv4()),
      name: String(item.name ?? "未命名图片"),
      image,
      naturalWidth: Math.max(1, Number(item.naturalWidth) || 1),
      naturalHeight: Math.max(1, Number(item.naturalHeight) || 1),
      addedAt: Number(item.addedAt) || Date.now()
    });
  }
  return out;
}

// 读整个库：常驻图片 + 用户移除过的记录
export async function fetchUploadLibrary(): Promise<UploadLibrary> {
  const empty: UploadLibrary = { images: [], hidden: [] };
  try {
    const response = await fetch("/api/uploads", { cache: "no-store" });
    if (!response.ok) {
      return empty;
    }
    const payload = await response.json();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const target = files.find((item: { name?: string }) => String(item?.name ?? "").startsWith(LIBRARY_NAME));
    // 库还不存在时直接收工：硬拼文件名去请求只会打出一个 404，
    // 而这个 404 会污染控制台、让「运行期无报错」的验收误判
    if (!target) {
      return empty;
    }
    const fileResponse = await fetch("/api/uploads/file?name=" + encodeURIComponent(String(target.name)), {
      cache: "no-store"
    });
    if (!fileResponse.ok) {
      return empty;
    }
    const parsed = await fileResponse.json();
    return {
      images: normalizeUploadedImages(parsed),
      hidden: normalizeHidden(parsed)
    };
  } catch {
    return empty;
  }
}

// 写回整个库。删除和隐藏都走这里。
export async function persistUploadLibrary(library: UploadLibrary): Promise<boolean> {
  try {
    const response = await fetch("/api/uploads/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: LIBRARY_NAME,
        content: JSON.stringify({ name: LIBRARY_NAME, images: library.images, hidden: library.hidden }, null, 2)
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}

// 增量追加：只把这批新增的原稿传上去，服务端读回旧库合并后写回。
// 之前是「读回整库 → 前端合并 → 全量写回」，请求体随库一起长大，
// 装到几十兆就会超过服务端上限，而且连接是被硬断的，前端只拿到一句 fetch failed。
// 单批上限。服务端对一次请求有体积上限，按体积切批之后
// "一次导入几十张"也不会撞上它。每批都是独立的增量追加、由服务端合并，
// 所以批与批之间不会互相覆盖。
const APPEND_BATCH_BYTES = 24 * 1024 * 1024;

export async function appendUploadedImages(list: UploadedImage[], revive: string[] = []): Promise<boolean> {
  if (list.length === 0) {
    return true;
  }

  const batches: UploadedImage[][] = [];
  let current: UploadedImage[] = [];
  let size = 0;
  for (const item of list) {
    const itemSize = item.image.length + 256;
    if (current.length > 0 && size + itemSize > APPEND_BATCH_BYTES) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length > 0) {
    batches.push(current);
  }

  let ok = true;
  for (const batch of batches) {
    try {
      const response = await fetch("/api/uploads/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: LIBRARY_NAME, items: batch, revive })
      });
      if (!response.ok) {
        ok = false;
      }
    } catch {
      ok = false;
    }
  }
  return ok;
}

// 隐藏/恢复只会动 hidden 这个字符串数组，单独写一次就够，
// 不必把整库的图片数据再传一遍
export async function persistHiddenImages(hidden: string[]): Promise<boolean> {
  try {
    const response = await fetch("/api/uploads/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: LIBRARY_NAME, hidden })
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function makeUploadedImage(
  name: string,
  image: string,
  naturalWidth: number,
  naturalHeight: number
): UploadedImage {
  return {
    id: "upload-" + uuidv4(),
    name,
    image,
    naturalWidth: Math.max(1, naturalWidth),
    naturalHeight: Math.max(1, naturalHeight),
    addedAt: Date.now()
  };
}
