import { v4 as uuidv4 } from "uuid";
import {
  Bubble,
  BubblePreset,
  BubbleType,
  CanvasConfig,
  CanvasPreset,
  Panel,
  PanelImage,
  PanelPoint,
  Project,
  ProjectPage
} from "../types";
import { DEFAULT_BUBBLE_TEXT_COLOR, normalizeHexColor } from "./colors";
import {
  getPolygonBounds,
  normalizePanelRotation,
  normalizePanelShape,
  Point,
  RECT_PANEL_SHAPE
} from "./panelGeometry";
import { clampOpacity, clampTextBox, normalizePreset } from "./presets";

export const CANVAS_PRESETS: Record<CanvasPreset, { width: number; height: number; dpi: number }> = {
  A4: {
    width: 2480,
    height: 3508,
    dpi: 300
  },
  A3: {
    width: 3508,
    height: 4961,
    dpi: 300
  },
  custom: {
    width: 1600,
    height: 2400,
    dpi: 300
  }
};

export const DEFAULT_BACKDROP_COLOR = "#ffffff";

// 预设实例化到画布时，气泡宽度占画布宽度的比例
export const PRESET_CANVAS_WIDTH_RATIO = 0.34;

// 对话框尺寸：下限对所有途径生效（滑条 / 数字输入 / 画布拖拽）；
// 上限只是滑条的可视范围，手动输入不受限制。
export const BUBBLE_SIZE_MIN = 30;
export const BUBBLE_SLIDER_MAX = 1000;

export function normalizeBubbleSize(value: number): number {
  if (!Number.isFinite(value)) {
    return BUBBLE_SIZE_MIN;
  }
  return Math.max(BUBBLE_SIZE_MIN, Math.round(value));
}

// 滑条位置：实际值超过滑条上限时停在末端，不回写、不篡改真实尺寸
export function toSliderValue(value: number): number {
  return Math.min(BUBBLE_SLIDER_MAX, normalizeBubbleSize(value));
}

export function createCanvasFromPreset(preset: CanvasPreset = "A4"): CanvasConfig {
  const picked = CANVAS_PRESETS[preset];
  return {
    width: picked.width,
    height: picked.height,
    preset,
    dpi: picked.dpi
  };
}

const DEFAULT_PANEL_STYLE: Pick<
  Panel,
  "borderColor" | "borderRadius" | "chamferRadius" | "borderWidth" | "cornerMode" | "gap" | "rotation" | "shape"
> = {
  borderWidth: 4,
  borderColor: "#111827",
  borderRadius: 0,
  chamferRadius: 0,
  cornerMode: "round",
  gap: 0,
  rotation: 0,
  shape: RECT_PANEL_SHAPE
};

export function createPanel(input: Pick<Panel, "x" | "y" | "width" | "height"> & Partial<Panel>): Panel {
  const width = Math.max(24, input.width);
  const height = Math.max(24, input.height);
  return {
    id: input.id ?? uuidv4(),
    x: input.x,
    y: input.y,
    width,
    height,
    rotation: normalizePanelRotation(input.rotation ?? DEFAULT_PANEL_STYLE.rotation),
    shape: normalizePanelShape(input.shape ?? DEFAULT_PANEL_STYLE.shape, width),
    borderColor: input.borderColor ?? DEFAULT_PANEL_STYLE.borderColor,
    borderRadius: input.borderRadius ?? DEFAULT_PANEL_STYLE.borderRadius,
    chamferRadius: input.chamferRadius ?? DEFAULT_PANEL_STYLE.chamferRadius,
    cornerMode: input.cornerMode ?? DEFAULT_PANEL_STYLE.cornerMode,
    borderWidth: input.borderWidth ?? DEFAULT_PANEL_STYLE.borderWidth,
    gap: input.gap ?? DEFAULT_PANEL_STYLE.gap,
    image: input.image,
    parentId: input.parentId,
    points: input.points && input.points.length >= 3 ? input.points : undefined,
    shapeKind: input.shapeKind
  };
}

// 椭圆分镜：按画布比例给一个居中的椭圆
export function createEllipsePanel(
  canvas: Pick<CanvasConfig, "width" | "height">,
  input: Partial<Panel> = {}
): Panel {
  const width = Math.max(80, input.width ?? canvas.width * 0.5);
  const height = Math.max(80, input.height ?? canvas.height * 0.3);
  const x = input.x ?? (canvas.width - width) / 2;
  const y = input.y ?? (canvas.height - height) / 2;

  return createPanel({
    ...input,
    x,
    y,
    width,
    height,
    shapeKind: "ellipse"
  });
}

export function createBubble(type: BubbleType = "rect", input: Partial<Bubble> = {}): Bubble {
  const safeType = input.type ?? type;
  const defaultWidth = safeType === "circle" ? 180 : 220;
  const defaultHeight = safeType === "circle" ? 180 : 160;
  const safeX = typeof input.x === "number" && Number.isFinite(input.x) ? input.x : 120;
  const safeY = typeof input.y === "number" && Number.isFinite(input.y) ? input.y : 120;
  const safeWidth = typeof input.width === "number" && Number.isFinite(input.width) ? input.width : defaultWidth;
  const safeHeight = typeof input.height === "number" && Number.isFinite(input.height) ? input.height : defaultHeight;
  const safeFontSize = typeof input.fontSize === "number" && Number.isFinite(input.fontSize) ? input.fontSize : 28;
  const safeBorderWidth =
    typeof input.borderWidth === "number" && Number.isFinite(input.borderWidth) ? input.borderWidth : 3;

  return {
    id: input.id ?? uuidv4(),
    type: safeType,
    x: safeX,
    y: safeY,
    width: normalizeBubbleSize(safeWidth),
    height: normalizeBubbleSize(safeHeight),
    text: input.text ?? "输入文字",
    direction: input.direction === "vertical" ? "vertical" : "horizontal",
    fontSize: Math.max(8, safeFontSize),
    fontFamily: input.fontFamily ?? "Noto Sans SC",
    textColor: normalizeHexColor(input.textColor, DEFAULT_BUBBLE_TEXT_COLOR),
    background: input.background ?? "#ffffff",
    borderColor: input.borderColor ?? "#111827",
    borderWidth: Math.max(0, safeBorderWidth),
    image: input.image,
    textBox: input.textBox ? clampTextBox(input.textBox) : undefined,
    presetId: input.presetId,
    strokeText: input.strokeText,
    strokeColor: input.strokeColor,
    strokeTextWidth: input.strokeTextWidth,
    opacity: clampOpacity(input.opacity)
  };
}

// 把预设铺到画布上：按画布尺寸等比换算气泡框与字号，保证不同画布下观感一致
export function createBubbleFromPreset(
  preset: BubblePreset,
  canvas: Pick<CanvasConfig, "width" | "height">,
  anchor: { x: number; y: number },
  text = "输入文字"
): Bubble {
  const targetWidth = Math.max(40, canvas.width * PRESET_CANVAS_WIDTH_RATIO);
  const scale = targetWidth / Math.max(1, preset.width);
  // 预设实例化跟随画布比例，不设上限；仅保证不低于最小尺寸
  const width = normalizeBubbleSize(preset.width * scale);
  const height = normalizeBubbleSize(preset.height * scale);

  return createBubble(preset.type === "image" ? "image" : preset.type, {
    x: Math.round(anchor.x - width / 2),
    y: Math.round(anchor.y - height / 2),
    width,
    height,
    text,
    direction: preset.direction,
    fontSize: Math.max(10, Math.round(preset.fontSize * scale)),
    fontFamily: preset.fontFamily,
    textColor: preset.textColor,
    background: preset.background,
    borderColor: preset.borderColor,
    borderWidth: preset.borderWidth,
    image: preset.image,
    textBox: preset.textBox,
    presetId: preset.id,
    strokeText: preset.strokeText,
    strokeColor: preset.strokeColor,
    strokeTextWidth: preset.strokeTextWidth,
    opacity: preset.opacity
  });
}

// 把画布上的气泡固化成预设，供后续复用
export function createBubblePresetFromBubble(bubble: Bubble, name: string): BubblePreset {
  return normalizePreset({
    id: `user:${uuidv4()}`,
    name: name.trim() || "自定义气泡",
    builtin: false,
    type: bubble.type === "image" ? "image" : bubble.type,
    width: Math.round(bubble.width),
    height: Math.round(bubble.height),
    textBox: bubble.textBox ?? clampTextBox({ x: 0.12, y: 0.12, width: 0.76, height: 0.76 }),
    background: bubble.background,
    borderColor: bubble.borderColor,
    borderWidth: bubble.borderWidth,
    borderRadius: bubble.type === "rounded" ? 24 : 0,
    image: bubble.image,
    direction: bubble.direction,
    fontSize: bubble.fontSize,
    fontFamily: bubble.fontFamily,
    textColor: bubble.textColor,
    strokeText: bubble.strokeText,
    strokeColor: bubble.strokeColor,
    strokeTextWidth: bubble.strokeTextWidth,
    opacity: clampOpacity(bubble.opacity)
  });
}

// 用画布绝对坐标的顶点创建多边形分镜，内部转成归一化局部坐标
export function createPolygonPanel(canvasPoints: Point[], input: Partial<Panel> = {}): Panel | null {
  if (canvasPoints.length < 3) {
    return null;
  }

  const bounds = getPolygonBounds(canvasPoints);
  const points: PanelPoint[] = canvasPoints.map((point) => ({
    x: (point.x - bounds.minX) / bounds.width,
    y: (point.y - bounds.minY) / bounds.height
  }));

  return createPanel({
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.width,
    height: bounds.height,
    ...input,
    points
  });
}

export function createDefaultPanelForCanvas(
  canvas: Pick<CanvasConfig, "width" | "height">,
  input: Partial<Panel> = {}
): Panel {
  return createPanel({
    x: input.x ?? 40,
    y: input.y ?? 40,
    width: input.width ?? canvas.width - 80,
    height: input.height ?? canvas.height - 80,
    ...input
  });
}

type CreatePageInput = {
  id?: string;
  name?: string;
  canvas?: CanvasConfig;
  panels?: Panel[];
  bubbles?: Bubble[];
  backdropColor?: string;
  background?: PanelImage;
  withDefaultPanel?: boolean;
};

export function createProjectPage(input: CreatePageInput = {}): ProjectPage {
  const canvas = input.canvas ?? createCanvasFromPreset("A4");
  // 页面默认是空的：画布底色铺满整页，分镜由用户扣选或导入原稿后自己加，
  // 而不是一上来就压一个用不上的白色空框。需要时显式传 withDefaultPanel。
  const panels =
    input.panels ?? (input.withDefaultPanel ? [createDefaultPanelForCanvas(canvas)] : []);

  return {
    id: input.id ?? uuidv4(),
    name: input.name ?? "第 1 页",
    canvas,
    panels,
    bubbles: input.bubbles ?? [],
    backdropColor: input.backdropColor ?? DEFAULT_BACKDROP_COLOR,
    background: input.background
  };
}

export function createEmptyProject(name = "未命名项目"): Project {
  const firstPage = createProjectPage();
  return {
    id: uuidv4(),
    name,
    pages: [firstPage],
    activePageId: firstPage.id
  };
}

export function splitGridPanels(
  canvasWidth: number,
  canvasHeight: number,
  rows: number,
  cols: number,
  margin?: number,
  gap?: number
): Panel[] {
  const safeRows = Math.max(1, rows);
  const safeCols = Math.max(1, cols);

  // 留白按画布短边比例给：原先固定 20px 在 2480 宽的画布上几乎看不见，
  // 切出来的格子会糊成一片
  const shortSide = Math.max(1, Math.min(canvasWidth, canvasHeight));
  const safeMargin = Math.max(0, Math.round(margin ?? shortSide * 0.022));
  const safeGap = Math.max(0, Math.round(gap ?? shortSide * 0.02));

  const totalGapX = safeGap * (safeCols - 1);
  const totalGapY = safeGap * (safeRows - 1);
  const availableWidth = canvasWidth - safeMargin * 2 - totalGapX;
  const availableHeight = canvasHeight - safeMargin * 2 - totalGapY;
  const cellWidth = Math.max(36, Math.floor(availableWidth / safeCols));
  const cellHeight = Math.max(36, Math.floor(availableHeight / safeRows));

  const output: Panel[] = [];
  for (let r = 0; r < safeRows; r += 1) {
    for (let c = 0; c < safeCols; c += 1) {
      output.push(
        createPanel({
          x: safeMargin + c * (cellWidth + safeGap),
          y: safeMargin + r * (cellHeight + safeGap),
          width: cellWidth,
          height: cellHeight,
          gap: 0
        })
      );
    }
  }

  return output;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
