// 内置贴纸库：坐标系统一为 0..100 的正方形，全部由几何函数生成
// 用数学生成而不是手写路径，形状错误在代码层面就无处可藏

export type StickerMode = "fill" | "stroke";

export type StickerDef = {
  id: string;
  name: string;
  group: string;
  path: string;
  viewBox: number;
  defaultColor: string;
  mode: StickerMode;
  strokeWidth?: number;
  // 描边端点的圆头设置，符号类贴纸看起来更自然
  lineCap?: "butt" | "round";
};

const TAU = Math.PI * 2;

export const STICKER_VIEWBOX = 100;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pt(x: number, y: number): string {
  return round(x) + " " + round(y);
}

// 极坐标点集连成闭合多边形
function closedPolygon(points: { x: number; y: number }[]): string {
  const head = points.map((point, index) => (index === 0 ? "M " : "L ") + pt(point.x, point.y));
  return head.join(" ") + " Z";
}

// 尖星：外半径与内半径交替。五角星、爆炸框都靠它
function spikyStar(arms: number, outer: number, inner: number, start: number): string {
  const points: { x: number; y: number }[] = [];
  const total = arms * 2;
  for (let index = 0; index < total; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = start + (index * Math.PI) / arms;
    points.push({ x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) });
  }
  return closedPolygon(points);
}

// 花瓣形：半径按余弦起伏，花瓣数决定对称度数
function petalShape(count: number, base: number, amplitude: number, samples: number): string {
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * TAU - Math.PI / 2;
    const radius = base + amplitude * Math.cos(count * (angle + Math.PI / 2));
    points.push({ x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) });
  }
  return closedPolygon(points);
}

// 整圆子路径。多个子路径在非零填充规则下会自动合并成一个轮廓，云朵和太阳靠这个拼
function circleSub(cx: number, cy: number, radius: number): string {
  return (
    "M " + pt(cx - radius, cy) +
    " A " + round(radius) + " " + round(radius) + " 0 1 0 " + pt(cx + radius, cy) +
    " A " + round(radius) + " " + round(radius) + " 0 1 0 " + pt(cx - radius, cy) +
    " Z"
  );
}

// 环状扇形，用于速度线这类放射状元素
function wedgeSub(a0: number, a1: number, r0: number, r1: number): string {
  const at = (radius: number, angle: number) => ({
    x: 50 + radius * Math.cos(angle),
    y: 50 + radius * Math.sin(angle)
  });
  const p1 = at(r1, a0);
  const p2 = at(r1, a1);
  const p3 = at(r0, a1);
  const p4 = at(r0, a0);
  return (
    "M " + pt(p1.x, p1.y) +
    " A " + round(r1) + " " + round(r1) + " 0 0 1 " + pt(p2.x, p2.y) +
    " L " + pt(p3.x, p3.y) +
    " A " + round(r0) + " " + round(r0) + " 0 0 0 " + pt(p4.x, p4.y) +
    " Z"
  );
}

// 四角闪光，控制点内收形成凹边
function sparkleAt(cx: number, cy: number, size: number): string {
  const outer = size / 2;
  const near = size * 0.06;
  const far = size * 0.28;
  return (
    "M " + pt(cx, cy - outer) +
    " C " + pt(cx + near, cy - far) + " " + pt(cx + far, cy - near) + " " + pt(cx + outer, cy) +
    " C " + pt(cx + far, cy + near) + " " + pt(cx + near, cy + far) + " " + pt(cx, cy + outer) +
    " C " + pt(cx - near, cy + far) + " " + pt(cx - far, cy + near) + " " + pt(cx - outer, cy) +
    " C " + pt(cx - far, cy - near) + " " + pt(cx - near, cy - far) + " " + pt(cx, cy - outer) +
    " Z"
  );
}

// 心形参数方程，等比缩放到 100x100 后居中
function heartShape(samples: number): string {
  const raw: { x: number; y: number }[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < samples; index += 1) {
    const t = (index / samples) * TAU;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    raw.push({ x, y });
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const scale = Math.min(100 / (maxX - minX), 100 / (maxY - minY));
  const offsetX = (100 - (maxX - minX) * scale) / 2;
  const offsetY = (100 - (maxY - minY) * scale) / 2;
  return closedPolygon(
    raw.map((point) => ({
      x: offsetX + (point.x - minX) * scale,
      y: offsetY + (point.y - minY) * scale
    }))
  );
}

function speedLineShape(count: number, inner: number, outer: number): string {
  const parts: string[] = [];
  const step = TAU / count;
  for (let index = 0; index < count; index += 1) {
    const start = index * step;
    parts.push(wedgeSub(start, start + step * 0.34, inner, outer));
  }
  return parts.join(" ");
}

function ribbonShape(): string {
  return (
    "M " + pt(50, 50) + " L " + pt(12, 24) + " L " + pt(12, 76) + " Z " +
    "M " + pt(50, 50) + " L " + pt(88, 24) + " L " + pt(88, 76) + " Z " +
    "M " + pt(50, 32) + " L " + pt(64, 50) + " L " + pt(50, 68) + " L " + pt(36, 50) + " Z"
  );
}

function noteShape(): string {
  return (
    circleSub(32, 74, 19) + " " +
    "M " + pt(47, 16) + " H 56 V 76 H 47 Z " +
    "M " + pt(56, 16) +
    " C " + pt(74, 19) + " " + pt(84, 31) + " " + pt(84, 46) +
    " L " + pt(75, 46) +
    " C " + pt(75, 35) + " " + pt(68, 28) + " " + pt(56, 25) +
    " Z"
  );
}

function cloudShape(): string {
  return (
    circleSub(32, 56, 21) + " " +
    circleSub(52, 42, 25) + " " +
    circleSub(72, 57, 19) + " " +
    "M " + pt(28, 56) + " H 74 V 76 H 28 Z"
  );
}

function sunShape(): string {
  const parts: string[] = [circleSub(50, 50, 23)];
  for (let index = 0; index < 8; index += 1) {
    const center = (index / 8) * TAU - Math.PI / 2;
    parts.push(wedgeSub(center - 0.12, center + 0.12, 30, 47));
  }
  return parts.join(" ");
}

function dotsShape(): string {
  const parts: string[] = [];
  const positions = [
    [28, 28], [50, 28], [72, 28],
    [28, 50], [50, 50], [72, 50],
    [28, 72], [50, 72], [72, 72]
  ];
  for (const position of positions) {
    parts.push(circleSub(position[0], position[1], 7));
  }
  return parts.join(" ");
}

// 心形与花瓣这类曲线形状采样密度高，路径偏长，但生成一次即可复用
const HEART_PATH = heartShape(140);

export const STICKERS: StickerDef[] = [
  { id: "heart", name: "爱心", group: "心与星", path: HEART_PATH, viewBox: 100, defaultColor: "#ef4444", mode: "fill" },
  { id: "heart-line", name: "空心爱心", group: "心与星", path: HEART_PATH, viewBox: 100, defaultColor: "#ef4444", mode: "stroke", strokeWidth: 8 },
  { id: "heart-sparkle", name: "心动", group: "心与星", path: HEART_PATH + " " + sparkleAt(84, 20, 30), viewBox: 100, defaultColor: "#f43f5e", mode: "fill" },
  { id: "star", name: "五角星", group: "心与星", path: spikyStar(5, 48, 20, -Math.PI / 2), viewBox: 100, defaultColor: "#f59e0b", mode: "fill" },
  { id: "star-line", name: "空心星", group: "心与星", path: spikyStar(5, 48, 20, -Math.PI / 2), viewBox: 100, defaultColor: "#f59e0b", mode: "stroke", strokeWidth: 7 },
  { id: "sparkle", name: "闪光", group: "心与星", path: sparkleAt(50, 50, 96), viewBox: 100, defaultColor: "#fbbf24", mode: "fill" },
  { id: "sparkles", name: "星群", group: "心与星", path: sparkleAt(36, 38, 56) + " " + sparkleAt(70, 60, 38) + " " + sparkleAt(62, 22, 26), viewBox: 100, defaultColor: "#fcd34d", mode: "fill" },
  { id: "diamond", name: "菱形", group: "心与星", path: "M " + pt(50, 8) + " L " + pt(88, 50) + " L " + pt(50, 92) + " L " + pt(12, 50) + " Z", viewBox: 100, defaultColor: "#38bdf8", mode: "fill" },

  { id: "flower", name: "六瓣花", group: "自然", path: petalShape(6, 30, 19, 220), viewBox: 100, defaultColor: "#f472b6", mode: "fill" },
  { id: "petal", name: "花瓣", group: "自然", path: "M " + pt(50, 6) + " C " + pt(76, 26) + " " + pt(82, 58) + " " + pt(50, 94) + " C " + pt(18, 58) + " " + pt(24, 26) + " " + pt(50, 6) + " Z", viewBox: 100, defaultColor: "#fb7185", mode: "fill" },
  { id: "cloud", name: "云朵", group: "自然", path: cloudShape(), viewBox: 100, defaultColor: "#e2e8f0", mode: "fill" },
  { id: "sun", name: "太阳", group: "自然", path: sunShape(), viewBox: 100, defaultColor: "#fbbf24", mode: "fill" },
  { id: "moon", name: "月牙", group: "自然", path: "M " + pt(62, 14) + " A 40 40 0 1 0 " + pt(62, 86) + " A 32 32 0 1 1 " + pt(62, 14) + " Z", viewBox: 100, defaultColor: "#a78bfa", mode: "fill" },
  { id: "drop", name: "水滴", group: "自然", path: "M " + pt(50, 6) + " L " + pt(78, 62) + " A 28 28 0 0 1 " + pt(22, 62) + " Z", viewBox: 100, defaultColor: "#60a5fa", mode: "fill" },

  { id: "note", name: "音符", group: "符号", path: noteShape(), viewBox: 100, defaultColor: "#0ea5e9", mode: "fill" },
  { id: "arrow-up", name: "箭头", group: "符号", path: "M " + pt(50, 6) + " L " + pt(86, 50) + " H 62 V 94 H 38 V 50 H 14 Z", viewBox: 100, defaultColor: "#64748b", mode: "fill" },
  { id: "cross", name: "十字", group: "符号", path: "M " + pt(42, 8) + " H 58 V 42 H 92 V 58 H 58 V 92 H 42 V 58 H 8 V 42 H 42 Z", viewBox: 100, defaultColor: "#ef4444", mode: "fill" },
  { id: "ring", name: "圆环", group: "符号", path: circleSub(50, 50, 40), viewBox: 100, defaultColor: "#22d3ee", mode: "stroke", strokeWidth: 10 },
  { id: "ribbon", name: "蝴蝶结", group: "符号", path: ribbonShape(), viewBox: 100, defaultColor: "#f472b6", mode: "fill" },

  { id: "burst", name: "爆炸框", group: "效果", path: spikyStar(12, 48, 27, -Math.PI / 2), viewBox: 100, defaultColor: "#f97316", mode: "fill" },
  { id: "burst-line", name: "爆炸线", group: "效果", path: spikyStar(12, 48, 32, -Math.PI / 2), viewBox: 100, defaultColor: "#fb923c", mode: "stroke", strokeWidth: 6 },
  { id: "speed", name: "速度线", group: "效果", path: speedLineShape(9, 26, 48), viewBox: 100, defaultColor: "#94a3b8", mode: "fill" },
  { id: "cross-burst", name: "十字爆闪", group: "效果", path: "M " + pt(50, 4) + " V 96 M " + pt(4, 50) + " H 96 M " + pt(16, 16) + " L " + pt(84, 84) + " M " + pt(84, 16) + " L " + pt(16, 84), viewBox: 100, defaultColor: "#fbbf24", mode: "stroke", strokeWidth: 9, lineCap: "round" },
  { id: "anger", name: "怒气", group: "效果", path: "M " + pt(36, 16) + " L " + pt(28, 84) + " M " + pt(64, 16) + " L " + pt(56, 84) + " M " + pt(14, 38) + " L " + pt(86, 28) + " M " + pt(14, 72) + " L " + pt(86, 62), viewBox: 100, defaultColor: "#dc2626", mode: "stroke", strokeWidth: 9, lineCap: "round" },
  { id: "blush", name: "腮红", group: "效果", path: "M " + pt(22, 38) + " L " + pt(38, 62) + " M " + pt(42, 32) + " L " + pt(58, 56) + " M " + pt(62, 38) + " L " + pt(78, 62), viewBox: 100, defaultColor: "#fb7185", mode: "stroke", strokeWidth: 8, lineCap: "round" },
  { id: "dots", name: "波点", group: "效果", path: dotsShape(), viewBox: 100, defaultColor: "#a855f7", mode: "fill" }
];

const STICKER_MAP = new Map(STICKERS.map((item) => [item.id, item]));

export function getStickerDef(id: string): StickerDef | undefined {
  return STICKER_MAP.get(id);
}


// 自定义贴纸：用户导入的图片。存在浏览器本地，也可以整体存进项目目录的 stickers/
export type CustomSticker = {
  id: string;
  name: string;
  image: string;
  naturalWidth: number;
  naturalHeight: number;
};

const CUSTOM_STICKER_KEY = "manga-dialog-studio:custom-stickers";

export function normalizeCustomStickers(input: unknown): CustomSticker[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item.image === "string" && item.image.startsWith("data:image"))
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : "custom-" + Math.random().toString(36).slice(2, 10),
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "自定义贴纸",
      image: item.image,
      naturalWidth: Number.isFinite(item.naturalWidth) ? item.naturalWidth : 100,
      naturalHeight: Number.isFinite(item.naturalHeight) ? item.naturalHeight : 100
    }));
}

export function getInitialCustomStickers(): CustomSticker[] {
  if (typeof localStorage === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(CUSTOM_STICKER_KEY);
    return raw ? normalizeCustomStickers(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function persistCustomStickers(list: CustomSticker[]): void {
  try {
    localStorage.setItem(CUSTOM_STICKER_KEY, JSON.stringify(list));
  } catch {
    // 超出浏览器配额时静默失败，本次会话内存里的数据仍然可用
  }
}

export function listStickerGroups(): { name: string; items: StickerDef[] }[] {
  const groups: { name: string; items: StickerDef[] }[] = [];
  for (const sticker of STICKERS) {
    const found = groups.find((group) => group.name === sticker.group);
    if (found) {
      found.items.push(sticker);
    } else {
      groups.push({ name: sticker.group, items: [sticker] });
    }
  }
  return groups;
}
