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

// 拉取 uploads/ 里的常驻图片；目录不存在或接口不可用时返回空数组
export async function fetchUploadedImages(): Promise<UploadedImage[]> {
  try {
    const response = await fetch("/api/uploads", { cache: "no-store" });
    if (!response.ok) {
      return [];
    }
    const payload = await response.json();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const target = files.find((item: { name?: string }) => String(item?.name ?? "").startsWith(LIBRARY_NAME));
    // 库还不存在时直接收工：硬拼文件名去请求只会打出一个 404，
    // 而这个 404 会污染控制台、让「运行期无报错」的验收误判
    if (!target) {
      return [];
    }
    const fileResponse = await fetch("/api/uploads/file?name=" + encodeURIComponent(String(target.name)), {
      cache: "no-store"
    });
    if (!fileResponse.ok) {
      return [];
    }
    return normalizeUploadedImages(await fileResponse.json());
  } catch {
    return [];
  }
}

// 追加保存。先读回已有内容再合并，避免多次导入互相覆盖。
export async function persistUploadedImages(list: UploadedImage[]): Promise<boolean> {
  if (list.length === 0) {
    return true;
  }
  try {
    // 同样先列目录再决定要不要读：库还不存在时直接读会打 404，
    // 那个 404 会污染控制台，让「运行期无报错」的验收误判
    const listing = await fetch("/api/uploads", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    const files = Array.isArray(listing?.files) ? listing.files : [];
    const target = files.find((item: { name?: string }) => String(item?.name ?? "").startsWith(LIBRARY_NAME));
    const previous = target
      ? await fetch("/api/uploads/file?name=" + encodeURIComponent(String(target.name)), { cache: "no-store" })
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null)
      : null;

    const merged = normalizeUploadedImages([
      ...normalizeUploadedImages(previous),
      ...list
    ]);

    const response = await fetch("/api/uploads/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: LIBRARY_NAME,
        content: JSON.stringify({ name: LIBRARY_NAME, images: merged }, null, 2)
      })
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
