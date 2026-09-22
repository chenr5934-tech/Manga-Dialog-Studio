// 界面外观：自定义背景壁纸 + 面板透明度。
// 配置存在本机 config/ui.json，由本地服务读写，不进版本库。

export type UiTheme = {
  wallpaper: string;
  wallpaperOpacity: number;
  wallpaperBlur: number;
  wallpaperDim: number;
  panelOpacity: number;
};

// 内置背景：不想自己找图的人也能换个底色。值直接是 CSS 背景图，
// 存在 config 里的写法是 "preset:<id>"，不带任何图片数据。
// effect：需要动态图层的背景额外挂一块 canvas（花瓣、水波）。
// 静态渐变不需要它，也就不该为它付任何代价。
export type WallpaperEffectKind = "sakura" | "waves";

export type PresetWallpaper = {
  id: string;
  label: string;
  css: string;
  effect?: WallpaperEffectKind;
};

export const PRESET_WALLPAPERS: PresetWallpaper[] = [
  {
    id: "preset:deep-night",
    label: "深海夜（暗色）",
    css:
      "radial-gradient(circle at 18% 12%, #1c3b6e 0%, transparent 45%)," +
      " radial-gradient(circle at 82% 78%, #0d2a4a 0%, transparent 50%)," +
      " linear-gradient(160deg, #060b14 0%, #0b1522 55%, #0a1a2b 100%)"
  },
  {
    id: "preset:sunset",
    label: "暖橘落日",
    css:
      "radial-gradient(circle at 78% 18%, #ff9d5c 0%, transparent 42%)," +
      " radial-gradient(circle at 12% 88%, #b8452f 0%, transparent 48%)," +
      " linear-gradient(155deg, #2a1220 0%, #55202c 50%, #7a3327 100%)"
  },
  {
    id: "preset:mist",
    label: "晨雾青（浅色）",
    css:
      "radial-gradient(circle at 20% 15%, #cfe8d8 0%, transparent 45%)," +
      " radial-gradient(circle at 85% 80%, #cfe0ee 0%, transparent 50%)," +
      " linear-gradient(150deg, #eef6f1 0%, #e6f0ea 60%, #dce9e4 100%)"
  },
  {
    id: "preset:sakura",
    label: "樱花粉（花瓣飘落）",
    css:
      "radial-gradient(circle at 22% 18%, #ffe0ec 0%, transparent 46%)," +
      " radial-gradient(circle at 80% 78%, #fff0dd 0%, transparent 52%)," +
      " linear-gradient(155deg, #fdf4f7 0%, #fbe9f1 50%, #f6dfeb 100%)",
    effect: "sakura"
  },
  {
    id: "preset:ocean",
    label: "海蓝（水面波光）",
    css:
      "radial-gradient(circle at 78% 12%, #12507e 0%, transparent 48%)," +
      " radial-gradient(circle at 18% 88%, #0a3355 0%, transparent 52%)," +
      " linear-gradient(168deg, #04121f 0%, #071f36 48%, #0a2b47 100%)",
    effect: "waves"
  }
];

// 存的值翻译成能吃进 background-image 的字符串：
// 上传的图是 dataURL，要包一层 url()；内置背景本身就是渐变色
export function wallpaperCss(value: string): string {
  if (!value) {
    return "none";
  }
  if (value.startsWith("preset:")) {
    return PRESET_WALLPAPERS.find((item) => item.id === value)?.css ?? "none";
  }
  return "url(" + value + ")";
}

export const DEFAULT_UI_THEME: UiTheme = {
  wallpaper: "",
  wallpaperOpacity: 100,
  wallpaperBlur: 0,
  wallpaperDim: 45,
  panelOpacity: 92
};

export async function fetchUiTheme(): Promise<UiTheme> {
  try {
    const response = await fetch("/api/ui/config", { cache: "no-store" });
    if (!response.ok) {
      return { ...DEFAULT_UI_THEME };
    }
    const payload = await response.json();
    return { ...DEFAULT_UI_THEME, ...payload };
  } catch {
    return { ...DEFAULT_UI_THEME };
  }
}

export async function saveUiTheme(theme: UiTheme): Promise<boolean> {
  try {
    const response = await fetch("/api/ui/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(theme)
    });
    return response.ok;
  } catch {
    return false;
  }
}

// 把配置写成 CSS 变量，样式表里直接引用。
// 壁纸用 ::before 之类的独立层做模糊和压暗，避免滤镜作用到内容上。
export function applyUiTheme(theme: UiTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const wallpaper = wallpaperCss(theme.wallpaper);
  const hasWallpaper = wallpaper !== "none";

  root.style.setProperty("--ui-wallpaper", wallpaper);
  root.style.setProperty("--ui-wallpaper-opacity", String(theme.wallpaperOpacity / 100));
  root.style.setProperty("--ui-wallpaper-blur", theme.wallpaperBlur + "px");
  root.style.setProperty("--ui-wallpaper-dim", String(theme.wallpaperDim / 100));
  root.style.setProperty("--ui-panel-alpha", String(theme.panelOpacity / 100));
  root.dataset.wallpaper = hasWallpaper ? "on" : "off";
}

// 把选中的图片压到合理尺寸再存，别让一张手机照片把 config 撑到十几兆
export async function readWallpaperFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取失败"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("解码失败"));
    element.src = dataUrl;
  });

  const MAX_EDGE = 2560;
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  if (scale >= 1 && file.size < 1_500_000) {
    return dataUrl;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    return dataUrl;
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}
