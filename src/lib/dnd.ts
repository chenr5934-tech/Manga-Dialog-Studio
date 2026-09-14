// 预设拖拽使用自定义 MIME，避免与文件拖入混淆
export const PRESET_DND_MIME = "application/x-manga-dialog-preset";
export const STICKER_DND_MIME = "application/x-manga-dialog-sticker";
export const POOLED_IMAGE_DND_MIME = "application/x-manga-dialog-pooled-image";
export const IMAGE_FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif";

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = src;
  });
}
