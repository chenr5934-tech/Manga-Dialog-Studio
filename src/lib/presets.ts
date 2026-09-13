import { BubblePreset, BubbleTextBox } from "../types";

const STORAGE_KEY = "manga-dialog-studio:presets:v1";
const INK = "#141a22";
const PAPER = "#ffffff";

function svgToDataUrl(svg: string): string {
  const normalized = svg.replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`;
}

function bubbleSvg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

type EllipseTailSpec = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  from: number;
  to: number;
  tipX: number;
  tipY: number;
};

// 椭圆本体与尾巴共用一条闭合轮廓，只描边一次，接缝处不会出现穿插的线条
function ellipseTailPath({ cx, cy, rx, ry, from, to, tipX, tipY }: EllipseTailSpec): string {
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) };
  };
  const start = point(from);
  const end = point(to);
  const round = (value: number) => Number(value.toFixed(2));
  // sweep=0 沿角度递减方向推进，large-arc=1 强制走长弧，剩余缺口正好留给尾巴
  return `M ${round(start.x)} ${round(start.y)} A ${rx} ${ry} 0 1 0 ${round(end.x)} ${round(end.y)} L ${round(tipX)} ${round(tipY)} Z`;
}

type BurstSpec = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  spikes: number;
  seed: number;
};

// 爆炸框：内外顶点交替的星形，扰动由固定种子驱动，保证每次生成完全一致
function burstPath({ cx, cy, rx, ry, spikes, seed }: BurstSpec): string {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const step = (Math.PI * 2) / (spikes * 2);
  const points: string[] = [];

  for (let index = 0; index < spikes * 2; index += 1) {
    const isOuter = index % 2 === 0;
    const jitter = isOuter ? 1 + random() * 0.18 : 1 - random() * 0.16;
    const angle = -Math.PI / 2 + index * step + (random() - 0.5) * step * 0.4;
    const radius = isOuter ? 1 : 0.54;
    const x = cx + Math.cos(angle) * rx * radius * jitter;
    const y = cy + Math.sin(angle) * ry * radius * jitter;
    points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }

  return `M ${points.join(" L ")} Z`;
}

const bodyStyle = `fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"`;

function speechRightSvg(): string {
  const outline = ellipseTailPath({ cx: 160, cy: 92, rx: 140, ry: 76, from: 35, to: 70, tipX: 258, tipY: 196 });
  return bubbleSvg(320, 200, `<path d="${outline}" ${bodyStyle}/>`);
}

function speechLeftSvg(): string {
  const outline = ellipseTailPath({ cx: 160, cy: 92, rx: 140, ry: 76, from: 110, to: 145, tipX: 62, tipY: 196 });
  return bubbleSvg(320, 200, `<path d="${outline}" ${bodyStyle}/>`);
}

function shoutSvg(): string {
  const outline = burstPath({ cx: 160, cy: 100, rx: 152, ry: 94, spikes: 14, seed: 20240917 });
  return bubbleSvg(320, 200, `<path d="${outline}" ${bodyStyle}/>`);
}

function thinkSvg(): string {
  const outline = ellipseTailPath({ cx: 150, cy: 76, rx: 130, ry: 66, from: 46, to: 62, tipX: 232, tipY: 140 });
  const dots = `
    <circle cx="244" cy="150" r="21" ${bodyStyle}/>
    <circle cx="276" cy="176" r="14" ${bodyStyle}/>
    <circle cx="299" cy="188" r="9" ${bodyStyle}/>
  `;
  return bubbleSvg(320, 200, `<path d="${outline}" ${bodyStyle}/>${dots}`);
}

function narrationSvg(): string {
  return bubbleSvg(
    320,
    200,
    `<rect x="7" y="7" width="306" height="186" rx="10" ${bodyStyle}/>`
  );
}

type PresetSeed = Omit<BubblePreset, "builtin"> & { builtin: true };

const BUILTIN_SEEDS: PresetSeed[] = [
  {
    id: "builtin:speech-right",
    name: "对话气泡 · 右尾",
    builtin: true,
    type: "image",
    width: 320,
    height: 200,
    textBox: { x: 0.1625, y: 0.24, width: 0.675, height: 0.44 },
    background: PAPER,
    borderColor: INK,
    borderWidth: 0,
    borderRadius: 0,
    image: speechRightSvg(),
    direction: "horizontal",
    fontSize: 30,
    fontFamily: "Noto Sans SC",
    textColor: INK,
    strokeText: false,
    strokeColor: "#ffffff",
    strokeTextWidth: 0
  },
  {
    id: "builtin:speech-left",
    name: "对话气泡 · 左尾",
    builtin: true,
    type: "image",
    width: 320,
    height: 200,
    textBox: { x: 0.1625, y: 0.24, width: 0.675, height: 0.44 },
    background: PAPER,
    borderColor: INK,
    borderWidth: 0,
    borderRadius: 0,
    image: speechLeftSvg(),
    direction: "horizontal",
    fontSize: 30,
    fontFamily: "Noto Sans SC",
    textColor: INK,
    strokeText: false,
    strokeColor: "#ffffff",
    strokeTextWidth: 0
  },
  {
    id: "builtin:shout",
    name: "喊叫 · 爆炸框",
    builtin: true,
    type: "image",
    width: 320,
    height: 200,
    textBox: { x: 0.28, y: 0.3, width: 0.44, height: 0.4 },
    background: PAPER,
    borderColor: INK,
    borderWidth: 0,
    borderRadius: 0,
    image: shoutSvg(),
    direction: "horizontal",
    fontSize: 28,
    fontFamily: "Noto Sans SC",
    textColor: INK,
    strokeText: false,
    strokeColor: "#ffffff",
    strokeTextWidth: 0
  },
  {
    id: "builtin:think",
    name: "内心 · 思考框",
    builtin: true,
    type: "image",
    width: 320,
    height: 200,
    textBox: { x: 0.156, y: 0.19, width: 0.625, height: 0.38 },
    background: PAPER,
    borderColor: INK,
    borderWidth: 0,
    borderRadius: 0,
    image: thinkSvg(),
    direction: "horizontal",
    fontSize: 26,
    fontFamily: "Noto Sans SC",
    textColor: INK,
    strokeText: false,
    strokeColor: "#ffffff",
    strokeTextWidth: 0
  },
  {
    id: "builtin:narration",
    name: "旁白框 · 方角",
    builtin: true,
    type: "image",
    width: 320,
    height: 200,
    textBox: { x: 0.07, y: 0.075, width: 0.86, height: 0.85 },
    background: PAPER,
    borderColor: INK,
    borderWidth: 0,
    borderRadius: 0,
    image: narrationSvg(),
    direction: "horizontal",
    fontSize: 26,
    fontFamily: "Noto Sans SC",
    textColor: INK,
    strokeText: false,
    strokeColor: "#ffffff",
    strokeTextWidth: 0
  },
  {
    id: "builtin:plain-ellipse",
    name: "无边框椭圆",
    builtin: true,
    type: "circle",
    width: 300,
    height: 220,
    textBox: { x: 0.16, y: 0.22, width: 0.68, height: 0.56 },
    background: "rgba(255,255,255,0.92)",
    borderColor: INK,
    borderWidth: 0,
    borderRadius: 0,
    direction: "horizontal",
    fontSize: 30,
    fontFamily: "Noto Sans SC",
    textColor: INK,
    strokeText: false,
    strokeColor: "#ffffff",
    strokeTextWidth: 0
  }
];

// seeds 里保存的是 SVG 源串，导出时统一转成 data URL 供 img / Konva 直接加载
export const BUILTIN_PRESETS: BubblePreset[] = BUILTIN_SEEDS.map((preset) => ({
  ...preset,
  image: preset.image ? svgToDataUrl(preset.image) : undefined
}));

// 不透明度统一收敛到 0..1，缺省表示完全不透明
export function clampOpacity(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(1, Math.max(0, value));
}

export function clampTextBox(input?: Partial<BubbleTextBox> | null): BubbleTextBox {
  const safe = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const x = Math.min(0.95, Math.max(0, safe(input?.x, 0.12)));
  const y = Math.min(0.95, Math.max(0, safe(input?.y, 0.12)));
  const width = Math.min(1 - x, Math.max(0.05, safe(input?.width, 0.76)));
  const height = Math.min(1 - y, Math.max(0.05, safe(input?.height, 0.76)));
  return { x, y, width, height };
}

function isPresetShape(value: unknown): value is BubblePreset {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<BubblePreset>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

export function normalizePreset(input: BubblePreset): BubblePreset {
  return {
    ...input,
    width: Math.max(24, Math.round(input.width)),
    height: Math.max(24, Math.round(input.height)),
    textBox: clampTextBox(input.textBox),
    borderWidth: Math.max(0, Number(input.borderWidth) || 0),
    borderRadius: Math.max(0, Number(input.borderRadius) || 0),
    fontSize: Math.max(8, Number(input.fontSize) || 28),
    fontFamily: input.fontFamily || "Noto Sans SC",
    textColor: input.textColor || INK,
    background: input.background || PAPER,
    borderColor: input.borderColor || INK,
    direction: input.direction === "vertical" ? "vertical" : "horizontal",
    type: input.image ? "image" : input.type === "image" ? "rounded" : input.type,
    opacity: clampOpacity(input.opacity),
    builtin: Boolean(input.builtin)
  };
}

export function loadUserPresets(): BubblePreset[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isPresetShape)
      .map((preset) => normalizePreset({ ...preset, builtin: false }));
  } catch {
    return [];
  }
}

export type PersistResult = {
  ok: boolean;
  message?: string;
};

export function saveUserPresets(list: BubblePreset[]): PersistResult {
  if (typeof window === "undefined") {
    return { ok: true };
  }
  try {
    const userOnly = list.filter((preset) => !preset.builtin);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(userOnly));
    return { ok: true };
  } catch {
    return { ok: false, message: "浏览器本地存储已满，请先删除部分自定义预设" };
  }
}

export function exportPresetsJson(list: BubblePreset[]): string {
  return JSON.stringify({ version: 1, presets: list }, null, 2);
}

export function importPresetsJson(text: string): BubblePreset[] {
  const parsed: unknown = JSON.parse(text);
  const rawList = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { presets?: unknown }).presets)
      ? (parsed as { presets: unknown[] }).presets
      : [];
  return rawList
    .filter(isPresetShape)
    .map((preset) => normalizePreset({ ...preset, builtin: false, id: `user:${preset.id ?? "imported"}:${Math.random().toString(36).slice(2, 8)}` }));
}
