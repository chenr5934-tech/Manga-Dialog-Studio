import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { Circle, Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Shape, Stage, Text, Transformer } from "react-konva";
import useImage from "use-image";
import { Bubble, OverlayImage, Panel, PanelPoint, ProjectPage } from "../types";
import { shouldPreserveImageTransparency } from "../lib/imageFormat";
import OverlayArtwork from "./OverlayArtwork";
import {
  PANEL_EDGE_HANDLE_KEYS,
  PANEL_SHAPE_HANDLE_KEYS,
  PanelEdgeKey,
  PanelShapeKey,
  Point,
  getPanelCanvasPoint,
  getPanelEdgeHandlePoint,
  getPanelRenderTransform,
  getPanelShapeGuideLines,
  getPanelShapeHandlePoint,
  getPolygonBounds,
  normalizePanelRotation,
  normalizePanelShape,
  updatePanelEdgeHandle,
  updatePanelShapeHandle
} from "../lib/panelGeometry";
import { drawPanelPath, getPanelImageLayout } from "../lib/panelRender";
import { DEFAULT_BACKDROP_COLOR, normalizeBubbleSize } from "../lib/project";
import { POOLED_IMAGE_DND_MIME, PRESET_DND_MIME, STICKER_DND_MIME } from "../lib/dnd";
import { findPooledImage } from "../lib/imagePool";
import { resolveLayerOrder } from "../lib/layers";
import { isPointInsidePanel } from "../lib/panelGeometry";
import { getActivePage, useEditorStore } from "../lib/store";
import { BubbleShapeLayer, BubbleTextLayer, resolveBubbleOpacity } from "./BubbleVisual";

type DraftRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasEditorHandle = {
  exportPng: () => Promise<void>;
  exportPdf: () => Promise<void>;
  exportPngZip: (pixelRatio?: number) => Promise<void>;
};

const ROTATION_SNAP_ANGLES = Array.from({ length: 72 }, (_value, index) => index * 5);
const ALL_TRANSFORMER_ANCHORS: string[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right"
];
const BUBBLE_TRANSFORMER_ANCHORS: string[] = ["top-center", "middle-left", "middle-right", "bottom-center"];
// 椭圆分镜只用四角锚点：它的斜切手柄没有意义，等比缩放靠 keepRatio
const ELLIPSE_TRANSFORMER_ANCHORS: string[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

function formatFilename(projectName: string, ext: "png" | "pdf" | "zip") {
  const safe = projectName.trim().replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_") || "manga-dialog-studio";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${safe}_${stamp}.${ext}`;
}

// 打包进 ZIP 的文件名带三位序号，解压后按名称排序即为漫画顺序
function formatPageEntryName(index: number, pageName: string) {
  const safe = pageName.trim().replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ") || "page";
  return `${String(index + 1).padStart(3, "0")}_${safe}.png`;
}

function triggerDownload(dataUrl: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}

function clampZoom(value: number) {
  return Math.min(1, Math.max(0.1, value));
}

function snapSize(value: number, minValue: number, step = 16) {
  const minMultiple = Math.ceil(minValue / step) * step;
  const snapped = Math.round(value / step) * step;
  return Math.max(minMultiple, snapped);
}

function getOrientation(width: number, height: number): "landscape" | "portrait" {
  return width >= height ? "landscape" : "portrait";
}

function waitForStageRefresh(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

// 等画布上所有图片节点真正拿到已解码的图片再截图。
// 只等两帧是不够的：切页之后 useImage 还在异步解码，大图往往要几百毫秒，
// 隔一页就会截到没有画面的空白页——批量导出时表现为"隔一张缺一张图"。
async function waitForImagesReady(stage: Konva.Stage, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // 切页之后 React 重渲染和 Konva 绘制都需要时间，先给一个下限，避免第一轮就误判"没有图片"。
  const minimumWaitUntil = Date.now() + 220;
  let stableRounds = 0;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 60));

    const nodes = stage.find("Image");

    // 真的没有图片的页面（比如空白页），过了下限就放行，不必等满超时
    if (nodes.length === 0) {
      if (Date.now() >= minimumWaitUntil) {
        return;
      }
      continue;
    }
    const allReady = nodes.every((node) => {
      // find("Image") 拿到的是基类 Node，取图片要按 Konva.Image 收窄
      const image = (node as Konva.Image).image?.() as HTMLImageElement | undefined;
      if (!image) {
        return true;
      }
      return image.complete !== false && (image.naturalWidth ?? 0) > 0;
    });

    // 要连续几轮都就绪才算稳，避免刚好卡在"旧页节点已就绪、新页还没挂上"的空窗期
    if (allReady && Date.now() >= minimumWaitUntil) {
      stableRounds += 1;
      if (stableRounds >= 3) {
        return;
      }
    } else {
      stableRounds = 0;
    }
  }
}

// 预解码：先把项目里用到的图片塞进浏览器缓存，切页时 useImage 能立刻命中
async function preloadProjectImages(urls: string[]): Promise<void> {
  const unique = Array.from(new Set(urls.filter((url) => typeof url === "string" && url.length > 0)));
  await Promise.all(
    unique.map(
      (url) =>
        new Promise<void>((resolve) => {
          const probe = new Image();
          probe.onload = () => resolve();
          probe.onerror = () => resolve();
          probe.src = url;
        })
    )
  );
}

// 收集一页里所有会用到的图片引用
function collectPageImageUrls(page: ProjectPage): string[] {
  const urls: string[] = [];
  if (page.background?.original) {
    urls.push(page.background.original);
  }
  for (const panel of page.panels) {
    if (panel.image?.original) {
      urls.push(panel.image.original);
    }
  }
  for (const overlay of page.overlays ?? []) {
    if (overlay.image) {
      urls.push(overlay.image);
    }
  }
  for (const bubble of page.bubbles) {
    if (bubble.image) {
      urls.push(bubble.image);
    }
  }
  return urls;
}

const SKEW_HANDLE_RADIUS = 15;
const SKEW_HANDLE_HIT_RADIUS = 30;
const SKEW_HANDLE_HIT_STROKE_WIDTH = 42;
const EDGE_HANDLE_SIZE = 42;
const EDGE_HANDLE_HIT_STROKE_WIDTH = 42;
const EDGE_HANDLE_CORNER_RADIUS = 8;
const SKEW_HANDLE_COLOR = "#2563eb";
const SKEW_GUIDE_COLOR = "rgba(37, 99, 235, 0.35)";
const TRANSFORMER_ANCHOR_SIZE = 18;
// 顶点手柄按屏幕尺寸恒定绘制，缩放画布时也保持好点
const POLYGON_HANDLE_SCREEN_RADIUS = 13;
const POLYGON_HANDLE_HIT_SCREEN_WIDTH = 30;

function PageBackgroundLayer({ page }: { page: ProjectPage }) {
  const [image] = useImage(page.background?.original ?? "", "anonymous");

  if (!image || !page.background) {
    return null;
  }

  return (
    <KonvaImage
      image={image}
      x={0}
      y={0}
      width={page.canvas.width}
      height={page.canvas.height}
      listening={false}
    />
  );
}

function PanelFillShape({ panel }: { panel: Panel }) {
  const fill = shouldPreserveImageTransparency(panel.image) ? "rgba(255, 255, 255, 0)" : "#ffffff";

  return (
    <Shape
      // Even transparent panels need a fill so Konva can build a hit area for selection and dragging.
      // 自定义 sceneFunc 的 Shape 不会自己算包围盒：getSelfRect 读的是 width/height，
      // 不设的话包围盒是 0×0，Transformer 的四个缩放手柄会全部叠在同一个点上。
      width={panel.width}
      height={panel.height}
      sceneFunc={(context, shape) => {
        context.beginPath();
        // 填充同样按 gap 内缩：边框与内容之间留出一圈底色，内边距才有肉眼可见的效果
        drawPanelPath(context, panel, panel.gap);
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      fill={fill}
    />
  );
}

function PanelBorderShape({
  panel,
  selected
}: {
  panel: Panel;
  selected: boolean;
}) {
  return (
    <Shape
      width={panel.width}
      height={panel.height}
      sceneFunc={(context, shape) => {
        context.beginPath();
        drawPanelPath(context, panel);
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      fillEnabled={false}
      stroke={selected ? SKEW_HANDLE_COLOR : panel.borderColor}
      strokeWidth={selected ? panel.borderWidth + 1 : panel.borderWidth}
      listening={false}
    />
  );
}

function PanelImageLayer({ panel }: { panel: Panel }) {
  const imageUrl = panel.image?.original ?? "";
  const [image] = useImage(imageUrl, "anonymous");

  if (!image || !panel.image) {
    return null;
  }

  const imageLayout = getPanelImageLayout(panel, {
    width: image.width,
    height: image.height
  });
  if (!imageLayout) {
    return null;
  }

  return (
    <Group
      clipFunc={(context) => {
        context.beginPath();
        drawPanelPath(context, panel, panel.gap);
        context.closePath();
      }}
      listening={false}
    >
      <KonvaImage
        image={image}
        x={imageLayout.offsetX}
        y={imageLayout.offsetY}
        width={imageLayout.drawWidth}
        height={imageLayout.drawHeight}
        crop={imageLayout.cropRect}
        listening={false}
      />
    </Group>
  );
}

// 多边形分镜的顶点编辑：每个顶点一个可拖拽手柄，拖动时实时预览、松手后收紧包围盒
function PolygonVertexHandles({
  panel,
  zoom,
  onDraftChange,
  onCommit
}: {
  panel: Panel;
  zoom: number;
  onDraftChange: (patch: Partial<Panel>) => void;
  onCommit: (patch: Partial<Panel>) => void;
}) {
  const points = panel.points ?? [];
  const transform = getPanelRenderTransform(panel);
  const radius = POLYGON_HANDLE_SCREEN_RADIUS / Math.max(0.01, zoom);
  const hitWidth = POLYGON_HANDLE_HIT_SCREEN_WIDTH / Math.max(0.01, zoom);

  if (points.length < 3) {
    return null;
  }

  const localPoints = points.map((point) => ({
    x: point.x * panel.width,
    y: point.y * panel.height
  }));

  const getLocalPointer = (node: Konva.Node): Point | null => {
    const parent = node.getParent();
    const stage = node.getStage();
    const pointer = stage?.getPointerPosition();
    if (!parent || !pointer) {
      return null;
    }
    return parent.getAbsoluteTransform().copy().invert().point(pointer);
  };

  const movedPoints = (index: number, local: Point) =>
    localPoints.map((point, i) => (i === index ? { x: local.x, y: local.y } : point));

  const toNormalized = (list: Point[], width: number, height: number): PanelPoint[] =>
    list.map((point) => ({
      x: point.x / Math.max(1, width),
      y: point.y / Math.max(1, height)
    }));

  const commitVertex = (index: number, local: Point) => {
    const next = movedPoints(index, local);
    const rotation = normalizePanelRotation(panel.rotation);

    // 旋转过的分镜需要额外的坐标补偿，这里只在未旋转时收紧包围盒，
    // 其余情况直接写回归一化顶点，渲染依然正确
    if (Math.abs(rotation) > 0.001) {
      onCommit({ points: toNormalized(next, panel.width, panel.height) });
      return;
    }

    const bounds = getPolygonBounds(next);
    onCommit({
      x: panel.x + bounds.minX,
      y: panel.y + bounds.minY,
      width: bounds.width,
      height: bounds.height,
      points: next.map((point) => ({
        x: (point.x - bounds.minX) / bounds.width,
        y: (point.y - bounds.minY) / bounds.height
      }))
    });
  };

  return (
    <Group
      name="panel-polygon-overlay"
      x={transform.x}
      y={transform.y}
      offsetX={transform.offsetX}
      offsetY={transform.offsetY}
      rotation={transform.rotation}
    >
      <Line
        points={localPoints.flatMap((point) => [point.x, point.y])}
        stroke={SKEW_GUIDE_COLOR}
        strokeWidth={2 / Math.max(0.01, zoom)}
        dash={[8 / Math.max(0.01, zoom), 5 / Math.max(0.01, zoom)]}
        closed
        listening={false}
      />

      {localPoints.map((point, index) => (
        <Circle
          key={`polygon-vertex-${index}`}
          name="panel-polygon-handle"
          x={point.x}
          y={point.y}
          radius={radius}
          hitStrokeWidth={hitWidth}
          fill="#eff6ff"
          stroke={SKEW_HANDLE_COLOR}
          strokeWidth={2}
          draggable
          onMouseDown={(event) => {
            event.cancelBubble = true;
          }}
          onTouchStart={(event) => {
            event.cancelBubble = true;
          }}
          onDragMove={(event) => {
            event.cancelBubble = true;
            const local = getLocalPointer(event.target);
            if (!local) {
              return;
            }
            onDraftChange({ points: toNormalized(movedPoints(index, local), panel.width, panel.height) });
          }}
          onDragEnd={(event) => {
            event.cancelBubble = true;
            const local = getLocalPointer(event.target);
            if (!local) {
              return;
            }
            commitVertex(index, local);
          }}
        />
      ))}
    </Group>
  );
}

function PanelSkewHandles({
  panel,
  onDraftChange,
  onCommit
}: {
  panel: Panel;
  onDraftChange: (patch: Partial<Panel>) => void;
  onCommit: (patch: Partial<Panel>) => void;
}) {
  const shape = normalizePanelShape(panel.shape, panel.width);
  const transform = getPanelRenderTransform(panel);
  const guideLines = getPanelShapeGuideLines(panel);

  const getLocalPointer = (node: Konva.Node): Point | null => {
    const parent = node.getParent();
    const stage = node.getStage();
    const pointer = stage?.getPointerPosition();
    if (!parent || !pointer) {
      return null;
    }
    return parent.getAbsoluteTransform().copy().invert().point(pointer);
  };

  const createBoundFunc =
    (key: PanelShapeKey) =>
    function dragBoundFunc(this: Konva.Node, position: Konva.Vector2d) {
      const localPoint = getLocalPointer(this);
      if (!localPoint) {
        return position;
      }

      const nextShape = updatePanelShapeHandle(shape, key, panel.width, localPoint.x);
      const nextLocalPoint = getPanelShapeHandlePoint({ width: panel.width, height: panel.height, shape: nextShape }, key);

      return getPanelCanvasPoint(panel, nextLocalPoint);
    };

  const createEdgeBoundFunc =
    (key: PanelEdgeKey) =>
    function dragBoundFunc(this: Konva.Node, position: Konva.Vector2d) {
      const localPoint = getLocalPointer(this);
      if (!localPoint) {
        return position;
      }

      const nextPanel = updatePanelEdgeHandle(panel, key, localPoint);
      const nextLocalPoint = getPanelEdgeHandlePoint(nextPanel, key);

      return getPanelCanvasPoint({ ...panel, ...nextPanel }, nextLocalPoint);
    };

  return (
    <Group
      name="panel-skew-overlay"
      x={transform.x}
      y={transform.y}
      offsetX={transform.offsetX}
      offsetY={transform.offsetY}
      rotation={transform.rotation}
    >
      <Line points={guideLines.top} stroke={SKEW_GUIDE_COLOR} strokeWidth={2} dash={[8, 5]} listening={false} />
      <Line points={guideLines.bottom} stroke={SKEW_GUIDE_COLOR} strokeWidth={2} dash={[8, 5]} listening={false} />

      {PANEL_EDGE_HANDLE_KEYS.map((key) => {
        const handlePoint = getPanelEdgeHandlePoint(panel, key);

        return (
          <Rect
            key={key}
            name="panel-skew-handle panel-edge-handle"
            x={handlePoint.x - EDGE_HANDLE_SIZE / 2}
            y={handlePoint.y - EDGE_HANDLE_SIZE / 2}
            width={EDGE_HANDLE_SIZE}
            height={EDGE_HANDLE_SIZE}
            cornerRadius={EDGE_HANDLE_CORNER_RADIUS}
            hitStrokeWidth={EDGE_HANDLE_HIT_STROKE_WIDTH}
            fill="#eff6ff"
            stroke={SKEW_HANDLE_COLOR}
            strokeWidth={2}
            draggable
            dragBoundFunc={createEdgeBoundFunc(key)}
            onMouseDown={(event) => {
              event.cancelBubble = true;
            }}
            onTouchStart={(event) => {
              event.cancelBubble = true;
            }}
            onDragMove={(event) => {
              event.cancelBubble = true;
              const localPointer = getLocalPointer(event.target);
              if (!localPointer) {
                return;
              }
              onDraftChange(updatePanelEdgeHandle(panel, key, localPointer));
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true;
              const localPointer = getLocalPointer(event.target);
              if (!localPointer) {
                return;
              }
              onCommit(updatePanelEdgeHandle(panel, key, localPointer));
            }}
          />
        );
      })}

      {PANEL_SHAPE_HANDLE_KEYS.map((key) => {
        const handlePoint = getPanelShapeHandlePoint(panel, key);

        return (
          <Circle
            key={key}
            name="panel-skew-handle"
            x={handlePoint.x}
            y={handlePoint.y}
            radius={SKEW_HANDLE_RADIUS}
            hitStrokeWidth={SKEW_HANDLE_HIT_STROKE_WIDTH}
            hitFunc={(context, shape) => {
              context.beginPath();
              context.arc(0, 0, SKEW_HANDLE_HIT_RADIUS, 0, Math.PI * 2);
              context.closePath();
              context.fillStrokeShape(shape);
            }}
            fill="#dbeafe"
            stroke={SKEW_HANDLE_COLOR}
            strokeWidth={2}
            draggable
            dragBoundFunc={createBoundFunc(key)}
            onMouseDown={(event) => {
              event.cancelBubble = true;
            }}
            onTouchStart={(event) => {
              event.cancelBubble = true;
            }}
            onDragMove={(event) => {
              event.cancelBubble = true;
              const localPointer = getLocalPointer(event.target);
              if (!localPointer) {
                return;
              }
              onDraftChange({
                shape: updatePanelShapeHandle(shape, key, panel.width, localPointer.x)
              });
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true;
              const localPointer = getLocalPointer(event.target);
              if (!localPointer) {
                return;
              }
              onCommit({
                shape: updatePanelShapeHandle(shape, key, panel.width, localPointer.x)
              });
            }}
          />
        );
      })}
    </Group>
  );
}

// 气泡外观统一由 BubbleVisual 提供，画布与缩略图共用同一套渲染逻辑

const CanvasEditor = forwardRef<CanvasEditorHandle>(function CanvasEditor(_props, ref) {
  const project = useEditorStore((state) => state.project);
  const activePage = useEditorStore((state) => getActivePage(state.project));
  const selection = useEditorStore((state) => state.selection);
  const manualPanelMode = useEditorStore((state) => state.manualPanelMode);
  const manualPanelShape = useEditorStore((state) => state.manualPanelShape);
  const snapSizeTo16 = useEditorStore((state) => state.snapSizeTo16);

  const setNotice = useEditorStore((state) => state.setNotice);
  const setActivePage = useEditorStore((state) => state.setActivePage);
  const selectPanel = useEditorStore((state) => state.selectPanel);
  const selectBubble = useEditorStore((state) => state.selectBubble);
  const selectOverlay = useEditorStore((state) => state.selectOverlay);
  const updateOverlay = useEditorStore((state) => state.updateOverlay);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const updatePanel = useEditorStore((state) => state.updatePanel);
  const updateBubble = useEditorStore((state) => state.updateBubble);
  const createPanelFromRect = useEditorStore((state) => state.createPanelFromRect);
  const addStickerOverlay = useEditorStore((state) => state.addStickerOverlay);
  const addOverlayImage = useEditorStore((state) => state.addOverlayImage);
  const uploadedImages = useEditorStore((state) => state.uploadedImages);
  // 统一层序：Konva 按 zIndex 排子节点，所以不必重排 JSX 结构
  const layerOrder = resolveLayerOrder(activePage);
  const zIndexOf = (id: string) => {
    const index = layerOrder.indexOf(id);
    return index < 0 ? 0 : index + 1;
  };
  const applyImageToPanel = useEditorStore((state) => state.applyImageToPanel);
  const createEllipsePanelFromRect = useEditorStore((state) => state.createEllipsePanelFromRect);
  const addBubbleFromPreset = useEditorStore((state) => state.addBubbleFromPreset);
  const toggleManualPanelMode = useEditorStore((state) => state.toggleManualPanelMode);
  const togglePolygonTool = useEditorStore((state) => state.togglePolygonTool);
  const agentScope = useEditorStore((state) => state.agentScope);
  const agentScopePicking = useEditorStore((state) => state.agentScopePicking);
  const setAgentScope = useEditorStore((state) => state.setAgentScope);
  const toggleAgentScopePicking = useEditorStore((state) => state.toggleAgentScopePicking);
  const createPolygonPanelFromPoints = useEditorStore((state) => state.createPolygonPanelFromPoints);
  const polygonTool = useEditorStore((state) => state.polygonTool);

  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const [zoom, setZoom] = useState(0.27);
  const [isExporting, setIsExporting] = useState(false);

  const [draftRect, setDraftRect] = useState<DraftRect | null>(null);
  const [draftStart, setDraftStart] = useState<{ x: number; y: number } | null>(null);
  const [panelDraft, setPanelDraft] = useState<{ panelId: string; patch: Partial<Panel> } | null>(null);
  const [polygonPoints, setPolygonPoints] = useState<{ x: number; y: number }[]>([]);
  const draftStartRef = useRef<{ x: number; y: number } | null>(null);

  // 扣选期间画布进入锁定态：已有分镜与气泡不响应事件、不可拖动，
  // 用户在任何位置按下都只会继续扣选，不会误拖底下的内容
  const pickingMode = manualPanelMode || polygonTool || agentScopePicking;

  const selectedNodeId = useMemo(() => {
    if (!selection) {
      return null;
    }

    if (selection.kind === "panel") {
      return `panel-${selection.id}`;
    }

    if (selection.kind === "overlay") {
      return `overlay-${selection.id}`;
    }

    return `bubble-${selection.id}`;
  }, [selection]);

  const selectedPanel = useMemo(() => {
    if (!selection || selection.kind !== "panel") {
      return undefined;
    }

    return activePage.panels.find((panel) => panel.id === selection.id);
  }, [activePage.panels, selection]);

  const liveSnapEnabled =
    snapSizeTo16 &&
    (selection?.kind !== "panel" || !selectedPanel || Math.abs(normalizePanelRotation(selectedPanel.rotation)) < 0.001);
  // 椭圆分镜用 Transformer 的四角手柄等比缩放。直接从 store 订阅，
  // 不走组件内的 useMemo——锚点配置对渲染时机很敏感，间接取到的值容易是旧的。
  const ellipsePanelSelected = useEditorStore((state) => {
    if (state.selection?.kind !== "panel") {
      return false;
    }
    const page = getActivePage(state.project);
    return page.panels.find((item) => item.id === state.selection?.id)?.shapeKind === "ellipse";
  });

  const styleTransformerAnchor = (anchor: Konva.Rect) => {
    if (selection?.kind !== "panel") {
      return;
    }

    if (ellipsePanelSelected && !anchor.hasName("rotater")) {
      return;
    }

    if (!anchor.hasName("rotater")) {
      anchor.visible(false);
      anchor.listening(false);
      anchor.width(0);
      anchor.height(0);
      return;
    }

    anchor.visible(true);
    anchor.listening(true);
    anchor.width(TRANSFORMER_ANCHOR_SIZE);
    anchor.height(TRANSFORMER_ANCHOR_SIZE);
    anchor.cornerRadius(TRANSFORMER_ANCHOR_SIZE / 2);
    anchor.fill("#eff6ff");
    anchor.stroke(SKEW_HANDLE_COLOR);
    anchor.strokeWidth(2);
  };

  useEffect(() => {
    if (!selection || selection.kind !== "panel") {
      setPanelDraft(null);
      return;
    }

    setPanelDraft((current) => (current?.panelId === selection.id ? current : null));
  }, [selection, activePage.id]);

  useEffect(() => {
    if (!transformerRef.current || !stageRef.current) {
      return;
    }

    if (!selectedNodeId) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
      return;
    }

    const node = stageRef.current.findOne(`#${selectedNodeId}`);
    if (!node) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
      return;
    }

    transformerRef.current.nodes([node]);
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedNodeId, activePage.id, activePage.panels, activePage.bubbles]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer || selection?.kind !== "panel") {
      return;
    }

    // 椭圆分镜没有斜切手柄，它靠 Transformer 的四角锚点等比缩放，
    // 这里不能跟着矩形/多边形一起把锚点收掉。
    if (ellipsePanelSelected) {
      return;
    }

    ALL_TRANSFORMER_ANCHORS.forEach((anchorName) => {
      const anchor = transformer.findOne<Konva.Rect>(`.${anchorName}`);
      if (!anchor) {
        return;
      }

      anchor.setAttrs({
        visible: false,
        listening: false,
        width: 0,
        height: 0
      });
    });

    transformer.getLayer()?.batchDraw();
  }, [selection?.kind, selectedNodeId, activePage.id, activePage.panels, activePage.bubbles]);

  const captureStageDataUrl = async (exportWidth: number, exportHeight: number, pixelRatio = 2) => {
    const stage = stageRef.current;
    if (!stage) {
      throw new Error("画布未初始化");
    }

    setIsExporting(true);
    await waitForStageRefresh();
    // 关键：等画面真正画完再截。只等两个 rAF 是不可靠的——切页后 React 重渲染、
    // 图片解码都还在路上，大页面会截到没有画面的空白页。
    await waitForImagesReady(stage);

    const prevWidth = stage.width();
    const prevHeight = stage.height();
    const prevScale = stage.scale();
    const prevNodes = transformerRef.current ? [...transformerRef.current.nodes()] : [];

    try {
      if (transformerRef.current) {
        transformerRef.current.nodes([]);
      }

      stage.width(exportWidth);
      stage.height(exportHeight);
      stage.scale({ x: 1, y: 1 });
      stage.batchDraw();

      return stage.toDataURL({
        mimeType: "image/png",
        pixelRatio
      });
    } finally {
      stage.width(prevWidth);
      stage.height(prevHeight);
      stage.scale(prevScale);

      if (transformerRef.current) {
        transformerRef.current.nodes(prevNodes);
        transformerRef.current.getLayer()?.batchDraw();
      }

      stage.batchDraw();
      setIsExporting(false);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      exportPng: async () => {
        try {
          const dataUrl = await captureStageDataUrl(activePage.canvas.width, activePage.canvas.height);
          const filename = formatFilename(project.name, "png");
          triggerDownload(dataUrl, filename);
          setNotice("PNG 导出完成");
        } catch (error) {
          const message = error instanceof Error ? error.message : "PNG 导出失败";
          setNotice(message);
        }
      },

      exportPdf: async () => {
        if (project.pages.length === 0) {
          setNotice("没有可导出的页面");
          return;
        }

        const originalPageId = project.activePageId;

        try {
          // 先把整册用到的图片解码好，切页时才不会出现"图片还没上来就截图"
          setNotice("正在准备图片...");
          await preloadProjectImages(project.pages.flatMap((item) => collectPageImageUrls(item)));
          const filename = formatFilename(project.name, "pdf");
          const { jsPDF } = await import("jspdf");

          let doc: InstanceType<typeof jsPDF> | null = null;

          for (let index = 0; index < project.pages.length; index += 1) {
            const page = project.pages[index];

            if (useEditorStore.getState().project.activePageId !== page.id) {
              setActivePage(page.id);
              await waitForStageRefresh();
            }

            const dataUrl = await captureStageDataUrl(page.canvas.width, page.canvas.height);
            const orientation = getOrientation(page.canvas.width, page.canvas.height);

            if (!doc) {
              doc = new jsPDF({
                orientation,
                unit: "px",
                format: [page.canvas.width, page.canvas.height],
                compress: true
              });
            } else {
              doc.addPage([page.canvas.width, page.canvas.height], orientation);
            }

            doc.addImage(dataUrl, "PNG", 0, 0, page.canvas.width, page.canvas.height, undefined, "FAST");
          }

          doc?.save(filename);
          setNotice("PDF 导出完成（按页面顺序）");
        } catch (error) {
          const message = error instanceof Error ? error.message : "PDF 导出失败";
          setNotice(message);
        } finally {
          if (useEditorStore.getState().project.activePageId !== originalPageId) {
            setActivePage(originalPageId);
            await waitForStageRefresh();
          }
        }
      },

      exportPngZip: async (pixelRatio = 2) => {
        if (project.pages.length === 0) {
          setNotice("没有可导出的页面");
          return;
        }

        const originalPageId = project.activePageId;

        try {
          const { default: JSZip } = await import("jszip");
          const zip = new JSZip();

          setNotice("正在准备图片...");
          await preloadProjectImages(project.pages.flatMap((item) => collectPageImageUrls(item)));

          for (let index = 0; index < project.pages.length; index += 1) {
            const page = project.pages[index];
            setNotice(`正在导出第 ${index + 1} / ${project.pages.length} 页...`);

            if (useEditorStore.getState().project.activePageId !== page.id) {
              setActivePage(page.id);
              await waitForStageRefresh();
            }

            const dataUrl = await captureStageDataUrl(page.canvas.width, page.canvas.height, pixelRatio);
            const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
            // PNG 已是压缩数据，ZIP 用 STORE 直接存放，避免无意义的二次压缩耗时
            zip.file(formatPageEntryName(index, page.name), base64, { base64: true });
          }

          const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = formatFilename(project.name, "zip");
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          // 立即回收会让下载来不及取数据，延迟释放
          window.setTimeout(() => URL.revokeObjectURL(url), 60000);
          setNotice(`已导出 ${project.pages.length} 张图片（ZIP）`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "ZIP 导出失败";
          setNotice(message);
        } finally {
          if (useEditorStore.getState().project.activePageId !== originalPageId) {
            setActivePage(originalPageId);
            await waitForStageRefresh();
          }
        }
      }
    }),
    [activePage.canvas.height, activePage.canvas.width, project.activePageId, project.name, project.pages, setActivePage, setNotice]
  );

  const toScene = (screen: { x: number; y: number }) => ({
    x: screen.x / zoom,
    y: screen.y / zoom
  });

  const polygonPreviewPoints = useMemo(
    () => polygonPoints.flatMap((point) => [point.x, point.y]),
    [polygonPoints]
  );

  const commitPolygon = () => {
    if (polygonPoints.length < 3) {
      setPolygonPoints([]);
      return;
    }

    createPolygonPanelFromPoints(polygonPoints);
    setPolygonPoints([]);
  };

  // 多边形用 Enter 闭合、Esc 放弃，避免与双击缩放等系统手势冲突
  useEffect(() => {
    if (!polygonTool) {
      setPolygonPoints([]);
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }

      if (event.key === "Escape") {
        // 两级退出：先放弃当前绘制，再退出扣选工具
        if (polygonPoints.length > 0) {
          setPolygonPoints([]);
          setNotice("已放弃当前多边形");
        } else {
          togglePolygonTool(false);
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (polygonPoints.length >= 3) {
          createPolygonPanelFromPoints(polygonPoints);
          setPolygonPoints([]);
        } else {
          setNotice("多边形至少需要 3 个顶点");
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createPolygonPanelFromPoints, polygonPoints, polygonTool, setNotice, togglePolygonTool]);

  // 矩形扣选同样支持 Esc：先取消正在拖出的选区，再退出扣选
  useEffect(() => {
    if (!manualPanelMode) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }

      if (event.key !== "Escape") {
        return;
      }

      if (draftStartRef.current) {
        draftStartRef.current = null;
        setDraftRect(null);
        setDraftStart(null);
        setNotice("已取消本次取景");
      } else {
        toggleManualPanelMode(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draftStart, manualPanelMode, setNotice, toggleManualPanelMode]);

  // 拖拽取景是高频交互，起点用 ref 同步保存：
  // 只靠 React state 的话，极快的拖动会在状态更新前就进入 mousemove，导致丢起点
  const beginManualPanel = (position: { x: number; y: number }) => {
    const scenePoint = toScene(position);
    draftStartRef.current = scenePoint;
    setDraftStart(scenePoint);
    setDraftRect({ x: scenePoint.x, y: scenePoint.y, width: 0, height: 0 });
  };

  const handleMouseDown = (event: any) => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    // 框定 Agent 作用范围：与扣选一样从拖动开始，但落点用于设置范围
    if (agentScopePicking) {
      const pointer = stage.getPointerPosition();
      if (!pointer) {
        return;
      }
      beginManualPanel(pointer);
      return;
    }

    // 扣选优先于一切元素交互：即使按在已有分镜或气泡上，也从扣选开始
    if (manualPanelMode) {
      const pointer = stage.getPointerPosition();
      if (!pointer) {
        return;
      }
      beginManualPanel(pointer);
      return;
    }

    if (polygonTool) {
      const pointer = stage.getPointerPosition();
      if (!pointer) {
        return;
      }

      const scenePoint = toScene(pointer);
      const first = polygonPoints[0];
      const closeRadius = 16 / Math.max(0.01, zoom);

      // 回到起点附近即视为闭合
      if (first && polygonPoints.length >= 3 && Math.hypot(scenePoint.x - first.x, scenePoint.y - first.y) <= closeRadius) {
        commitPolygon();
        return;
      }

      setPolygonPoints((current) => [...current, scenePoint]);
      return;
    }

    const target = event.target;
    const onPanel = Boolean(target?.findAncestor?.(".panel-node", true));
    const onBubble = Boolean(target?.findAncestor?.(".bubble-node", true));
    // 图片层与贴纸也要算进来：漏掉它会在按下的瞬间清空选中，拖拽过程中又没有 click 事件补回来
    const onOverlay = Boolean(target?.findAncestor?.(".overlay-node", true));
    const onTransformer = Boolean(target?.findAncestor?.(".selection-transformer", true));
    const onSkewHandle = Boolean(target?.findAncestor?.(".panel-skew-handle", true) || target?.findAncestor?.(".panel-skew-overlay", true));
    if (onPanel || onBubble || onOverlay || onTransformer || onSkewHandle) {
      return;
    }

    clearSelection();
  };

  const handleMouseMove = () => {
    const start = draftStartRef.current;
    if (!manualPanelMode || !start || !stageRef.current) {
      return;
    }

    const pointer = stageRef.current.getPointerPosition();
    if (!pointer) {
      return;
    }

    const scenePoint = toScene(pointer);
    setDraftRect({
      x: start.x,
      y: start.y,
      width: scenePoint.x - start.x,
      height: scenePoint.y - start.y
    });
  };

  // 松手时指针很可能已经移出画布（尤其是往边缘拖），若只监听 Stage 会丢掉这次取景。
  // 因此改在 window 上监听，并用容器矩形自行换算场景坐标。
  useEffect(() => {
    if (!manualPanelMode && !agentScopePicking) {
      return;
    }

    const onWindowMouseUp = (event: MouseEvent) => {
      const start = draftStartRef.current;
      if (!start) {
        return;
      }

      draftStartRef.current = null;
      setDraftStart(null);
      setDraftRect(null);

      const stage = stageRef.current;
      if (!stage) {
        return;
      }

      const rect = stage.container().getBoundingClientRect();
      const end = toScene({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      });

      const width = end.x - start.x;
      const height = end.y - start.y;

      // 过小的误触直接忽略，避免产生碎片分镜
      if (Math.abs(width) < 8 || Math.abs(height) < 8) {
        return;
      }

      if (useEditorStore.getState().agentScopePicking) {
        setAgentScope({
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          width: Math.abs(width),
          height: Math.abs(height)
        });
        return;
      }

      if (manualPanelShape === "ellipse") {
        createEllipsePanelFromRect(start.x, start.y, width, height);
      } else {
        createPanelFromRect(start.x, start.y, width, height);
      }
    };

    window.addEventListener("mouseup", onWindowMouseUp);
    return () => window.removeEventListener("mouseup", onWindowMouseUp);
  }, [
    agentScopePicking,
    createEllipsePanelFromRect,
    createPanelFromRect,
    manualPanelMode,
    manualPanelShape,
    setAgentScope,
    zoom
  ]);

  const adjustZoom = (delta: number) => {
    setZoom((current) => clampZoom(current + delta));
  };

  return (
    <div className="studio-surface flex h-full w-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-[var(--panel-border)] px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="studio-btn h-7 w-7 px-0 text-sm leading-none"
            onClick={() => adjustZoom(-0.05)}
            title="缩小"
            aria-label="缩小"
          >
            -
          </button>
          <label className="text-[12px] text-[var(--text-secondary)]">缩放 {Math.round(zoom * 100)}%</label>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(clampZoom(Number(event.target.value)))}
            className="w-28 accent-[var(--accent)]"
          />
          <button
            type="button"
            className="studio-btn h-7 w-7 px-0 text-sm leading-none"
            onClick={() => adjustZoom(0.05)}
            title="放大"
            aria-label="放大"
          >
            +
          </button>
        </div>
      </div>

      {pickingMode && (
        <div className="shrink-0 border-b border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-primary)]">
            <span className="studio-chip px-2 py-0.5 font-semibold">
              {agentScopePicking ? "框定 Agent 范围" : manualPanelMode ? "矩形扣选中" : "多边形扣选中"}
            </span>
            <span className="text-[var(--text-secondary)]">
              {agentScopePicking
                ? "在画布上拖拽框出一块区域，Agent 之后只会在该区域内新增内容"
                : manualPanelMode
                  ? "画布已锁定，拖拽即可取景；已有分镜与气泡不会被拖动"
                  : "画布已锁定，单击逐个取点；回到起点、按 Enter 或点画布下方的「完成闭合」都能收口"}
            </span>
            <button
              type="button"
              className="studio-btn ml-auto h-6 px-2 text-[12px]"
              onClick={() => {
                if (agentScopePicking) {
                  toggleAgentScopePicking(false);
                } else if (manualPanelMode) {
                  toggleManualPanelMode(false);
                } else {
                  togglePolygonTool(false);
                }
              }}
            >
              {agentScopePicking ? "取消框定" : "退出扣选"}
            </button>
          </div>
        </div>
      )}

      {polygonTool && (
        <div
          data-polygon-hint="1"
          className="shrink-0 border-b border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2"
        >
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            {polygonPoints.length >= 3 ? (
              <>
                <span className="text-[var(--text-primary)]">按</span>
                <kbd className="rounded border border-[var(--line-strong)] bg-[var(--panel-0)] px-2 py-0.5 font-mono text-[12px] font-semibold text-[var(--text-primary)]">
                  Enter
                </kbd>
                <span className="font-semibold text-[var(--text-primary)]">键闭合多边形</span>
                <button type="button" className="studio-btn studio-btn-primary h-7 px-3 text-[12px]" onClick={commitPolygon}>
                  完成闭合
                </button>
                <button type="button" className="studio-btn h-7 px-2 text-[12px]" onClick={() => setPolygonPoints([])}>
                  重来
                </button>
              </>
            ) : (
              <span className="text-[var(--text-primary)]">
                依次单击取点（已放置 {polygonPoints.length} 个，至少需要 3 个才能闭合）
              </span>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 overflow-auto">
        <div className="studio-workspace min-w-fit p-6 lg:p-8">
          <div
            className={`relative overflow-hidden rounded-xl border bg-slate-100 shadow-[0_28px_70px_rgba(2,6,23,0.4)] ${
              pickingMode ? "cursor-crosshair border-[var(--accent)]" : "border-slate-300/90"
            }`}
            style={{
              width: Math.ceil(activePage.canvas.width * zoom),
              height: Math.ceil(activePage.canvas.height * zoom)
            }}
            onDragOver={(event) => {
              if (
                event.dataTransfer.types.includes(PRESET_DND_MIME) ||
                event.dataTransfer.types.includes(STICKER_DND_MIME) ||
                event.dataTransfer.types.includes(POOLED_IMAGE_DND_MIME)
              ) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(event) => {
              const pooledId = event.dataTransfer.getData(POOLED_IMAGE_DND_MIME);
              const stickerId = event.dataTransfer.getData(STICKER_DND_MIME);
              const presetId = event.dataTransfer.getData(PRESET_DND_MIME);
              if (!pooledId && !stickerId && !presetId) {
                return;
              }

              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const scenePoint = toScene({
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
              });

              // 贴纸拖进来时以指针为中心落下，和气泡预设的投放行为一致
              if (stickerId) {
                addStickerOverlay(stickerId, undefined, scenePoint);
                return;
              }

              // 图片池拖进来：落在某个分镜上先问一句，落在空白则在上层新建一张图片
              if (pooledId) {
                const liveProject = useEditorStore.getState().project;
                const livePage = getActivePage(liveProject);
                // 必须和左侧「已导入图片」用同一份常驻列表，否则索引会对不上
                const pooled = findPooledImage(pooledId, uploadedImages);
                if (!pooled) {
                  return;
                }

                // 后加的在上层，所以从后往前找，命中的就是视觉上盖在最上面的那一格
                const target = [...livePage.panels]
                  .reverse()
                  .find((panel) => isPointInsidePanel(panel, scenePoint));

                if (
                  target &&
                  window.confirm("把这张图片放进这个分镜吗？\n\n选「取消」则改为在画布上层新建一张图片。")
                ) {
                  applyImageToPanel(target.id, {
                    original: pooled.src,
                    naturalWidth: pooled.naturalWidth ?? 1,
                    naturalHeight: pooled.naturalHeight ?? 1
                  });
                  return;
                }

                addOverlayImage({
                  image: pooled.src,
                  naturalWidth: pooled.naturalWidth ?? 1,
                  naturalHeight: pooled.naturalHeight ?? 1,
                  anchor: scenePoint
                });
                return;
              }

              addBubbleFromPreset(presetId, scenePoint);
            }}
          >
            <Stage
              ref={stageRef}
              width={Math.ceil(activePage.canvas.width * zoom)}
              height={Math.ceil(activePage.canvas.height * zoom)}
              scaleX={zoom}
              scaleY={zoom}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              className="bg-slate-200"
            >
              <Layer>
                <Rect
                  name="canvas-bg"
                  x={0}
                  y={0}
                  width={activePage.canvas.width}
                  height={activePage.canvas.height}
                  fill={activePage.backdropColor ?? DEFAULT_BACKDROP_COLOR}
                />

                <PageBackgroundLayer page={activePage} />

              {activePage.panels.map((panel) => {
                const selected = !isExporting && selection?.kind === "panel" && selection.id === panel.id;
                const displayPanel =
                  panelDraft?.panelId === panel.id
                    ? {
                        ...panel,
                        ...panelDraft.patch,
                        shape: panelDraft.patch.shape ?? panel.shape
                      }
                    : panel;
                const transform = getPanelRenderTransform(displayPanel);

                return (
                  <Fragment key={panel.id}>
                    <Group
                      id={`panel-${panel.id}`}
                      name="panel-node"
                      zIndex={zIndexOf(panel.id)}
                      x={transform.x}
                      y={transform.y}
                      width={displayPanel.width}
                      height={displayPanel.height}
                      offsetX={transform.offsetX}
                      offsetY={transform.offsetY}
                      rotation={transform.rotation}
                      listening={!pickingMode}
                      draggable={!pickingMode}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        selectPanel(panel.id);
                      }}
                      onTap={(event) => {
                        event.cancelBubble = true;
                        selectPanel(panel.id);
                      }}
                      onDragEnd={(event) => {
                        const nextWidth = snapSizeTo16 ? snapSize(panel.width, 24) : panel.width;
                        const nextHeight = snapSizeTo16 ? snapSize(panel.height, 24) : panel.height;
                        updatePanel(panel.id, {
                          x: event.target.x() - nextWidth / 2,
                          y: event.target.y() - nextHeight / 2,
                          width: nextWidth,
                          height: nextHeight
                        });
                      }}
                      onTransformEnd={(event) => {
                        const node = event.target;
                        let nextWidth = Math.max(24, node.width() * node.scaleX());
                        let nextHeight = Math.max(24, node.height() * node.scaleY());
                        if (snapSizeTo16) {
                          nextWidth = snapSize(nextWidth, 24);
                          nextHeight = snapSize(nextHeight, 24);
                        }
                        node.scaleX(1);
                        node.scaleY(1);
                        updatePanel(panel.id, {
                          x: node.x() - nextWidth / 2,
                          y: node.y() - nextHeight / 2,
                          width: nextWidth,
                          height: nextHeight,
                          rotation: normalizePanelRotation(node.rotation())
                        });
                      }}
                    >
                      <PanelFillShape panel={displayPanel} />
                      <PanelImageLayer panel={displayPanel} />
                      <PanelBorderShape panel={displayPanel} selected={selected} />
                    </Group>

                    {selected && displayPanel.points && !pickingMode ? (
                      <PolygonVertexHandles
                        panel={displayPanel}
                        zoom={zoom}
                        onDraftChange={(patch) => {
                          setPanelDraft({
                            panelId: panel.id,
                            patch
                          });
                        }}
                        onCommit={(patch) => {
                          setPanelDraft(null);
                          updatePanel(panel.id, patch);
                        }}
                      />
                    ) : null}

                    {selected &&
                      !displayPanel.points &&
                      displayPanel.shapeKind !== "ellipse" &&
                      !pickingMode ? (
                      <PanelSkewHandles
                        panel={displayPanel}
                        onDraftChange={(patch) => {
                          setPanelDraft({
                            panelId: panel.id,
                            patch
                          });
                        }}
                        onCommit={(patch) => {
                          setPanelDraft(null);
                          updatePanel(panel.id, patch);
                        }}
                      />
                    ) : null}
                  </Fragment>
                );
              })}

              {(activePage.overlays ?? []).map((overlay) => {
                const selected =
                  !isExporting && selection?.kind === "overlay" && selection.id === overlay.id;

                return (
                  <Group
                    key={overlay.id}
                    id={`overlay-${overlay.id}`}
                    name="overlay-node"
                    zIndex={zIndexOf(overlay.id)}
                    x={overlay.x + overlay.width / 2}
                    y={overlay.y + overlay.height / 2}
                    width={overlay.width}
                    height={overlay.height}
                    offsetX={overlay.width / 2}
                    offsetY={overlay.height / 2}
                    rotation={overlay.rotation}
                    opacity={overlay.opacity ?? 1}
                    listening={!pickingMode}
                    draggable={!pickingMode}
                    onClick={(event) => {
                      event.cancelBubble = true;
                      selectOverlay(overlay.id);
                    }}
                    onTap={(event) => {
                      event.cancelBubble = true;
                      selectOverlay(overlay.id);
                    }}
                    onDragEnd={(event) => {
                      updateOverlay(overlay.id, {
                        x: event.target.x() - overlay.width / 2,
                        y: event.target.y() - overlay.height / 2
                      });
                    }}
                    onTransformEnd={(event) => {
                      const node = event.target;
                      const nextWidth = Math.max(24, node.width() * node.scaleX());
                      const nextHeight = Math.max(24, node.height() * node.scaleY());
                      node.scaleX(1);
                      node.scaleY(1);
                      updateOverlay(overlay.id, {
                        x: node.x() - nextWidth / 2,
                        y: node.y() - nextHeight / 2,
                        width: nextWidth,
                        height: nextHeight,
                        rotation: normalizePanelRotation(node.rotation())
                      });
                    }}
                  >
                    {/* Konva 的命中检测按子节点进行：artwork 内部一律 listening=false，
                        所以这里必须放一块（视觉上看不见的）命中区，否则整层点不中、拖不动 */}
                    <Rect
                      width={overlay.width}
                      height={overlay.height}
                      fill="rgba(0,0,0,0.001)"
                      listening={!pickingMode}
                    />
                    <OverlayArtwork overlay={overlay} />
                    {selected ? (
                      <Rect
                        width={overlay.width}
                        height={overlay.height}
                        stroke="#2563eb"
                        strokeWidth={2}
                        dash={[8, 5]}
                        listening={false}
                      />
                    ) : null}
                  </Group>
                );
              })}

              {activePage.bubbles.map((bubble) => {
                const selected = !isExporting && selection?.kind === "bubble" && selection.id === bubble.id;
                return (
                  <Group
                    key={bubble.id}
                    id={`bubble-${bubble.id}`}
                    name="bubble-node"
                    zIndex={zIndexOf(bubble.id)}
                    x={bubble.x}
                    y={bubble.y}
                    width={bubble.width}
                    height={bubble.height}
                    opacity={resolveBubbleOpacity(bubble)}
                    listening={!pickingMode}
                    draggable={!pickingMode}
                    onClick={(event) => {
                      event.cancelBubble = true;
                      selectBubble(bubble.id);
                    }}
                    onTap={(event) => {
                      event.cancelBubble = true;
                      selectBubble(bubble.id);
                    }}
                    onDragEnd={(event) => {
                      const nextWidth = snapSizeTo16 ? snapSize(bubble.width, 30) : bubble.width;
                      const nextHeight = snapSizeTo16 ? snapSize(bubble.height, 30) : bubble.height;
                      updateBubble(bubble.id, {
                        x: event.target.x(),
                        y: event.target.y(),
                        width: nextWidth,
                        height: nextHeight
                      });
                    }}
                    onTransformEnd={(event) => {
                      const node = event.target;
                      let nextWidth = normalizeBubbleSize(node.width() * node.scaleX());
                      let nextHeight = normalizeBubbleSize(node.height() * node.scaleY());
                      if (snapSizeTo16) {
                        nextWidth = snapSize(nextWidth, 30);
                        nextHeight = snapSize(nextHeight, 30);
                      }
                      node.scaleX(1);
                      node.scaleY(1);
                      updateBubble(bubble.id, {
                        x: node.x(),
                        y: node.y(),
                        width: nextWidth,
                        height: nextHeight
                      });
                    }}
                  >
                    <BubbleShapeLayer bubble={bubble} />
                    <BubbleTextLayer bubble={bubble} />
                    {selected && <Rect width={bubble.width} height={bubble.height} stroke="#2563eb" strokeWidth={2} dash={[8, 5]} />}
                  </Group>
                );
              })}

              {agentScope && !isExporting && (
                <Group listening={false}>
                  <Rect
                    x={agentScope.x}
                    y={agentScope.y}
                    width={agentScope.width}
                    height={agentScope.height}
                    fill="rgba(245, 158, 11, 0.07)"
                    stroke="#f59e0b"
                    strokeWidth={3 / Math.max(0.01, zoom)}
                    dash={[14 / Math.max(0.01, zoom), 8 / Math.max(0.01, zoom)]}
                    listening={false}
                  />
                  <Text
                    x={agentScope.x}
                    y={Math.max(0, agentScope.y - 28 / Math.max(0.01, zoom))}
                    text="Agent 作用范围"
                    fontSize={22 / Math.max(0.01, zoom)}
                    fontFamily="Noto Sans SC"
                    fill="#b45309"
                    listening={false}
                  />
                </Group>
              )}

              {polygonTool && polygonPoints.length > 0 && (
                <>
                  <Line
                    points={polygonPreviewPoints}
                    stroke="#2563eb"
                    strokeWidth={2 / Math.max(0.01, zoom)}
                    dash={[10 / Math.max(0.01, zoom), 6 / Math.max(0.01, zoom)]}
                    closed={polygonPoints.length >= 3}
                    listening={false}
                  />
                  {polygonPoints.map((point, index) => (
                    <Circle
                      key={`polygon-point-${index}`}
                      x={point.x}
                      y={point.y}
                      radius={(index === 0 ? 7 : 5) / Math.max(0.01, zoom)}
                      fill={index === 0 ? "#2563eb" : "#ffffff"}
                      stroke="#2563eb"
                      strokeWidth={2 / Math.max(0.01, zoom)}
                      listening={false}
                    />
                  ))}
                </>
              )}

              {draftRect && manualPanelMode ? (
                manualPanelShape === "ellipse" ? (
                  <Ellipse
                    x={draftRect.x + draftRect.width / 2}
                    y={draftRect.y + draftRect.height / 2}
                    radiusX={Math.abs(draftRect.width) / 2}
                    radiusY={Math.abs(draftRect.height) / 2}
                    fill="rgba(37, 99, 235, 0.2)"
                    stroke="#1d4ed8"
                    strokeWidth={2}
                    dash={[8, 6]}
                  />
                ) : (
                  <Rect
                    x={draftRect.width >= 0 ? draftRect.x : draftRect.x + draftRect.width}
                    y={draftRect.height >= 0 ? draftRect.y : draftRect.y + draftRect.height}
                    width={Math.abs(draftRect.width)}
                    height={Math.abs(draftRect.height)}
                    fill="rgba(37, 99, 235, 0.2)"
                    stroke="#1d4ed8"
                    strokeWidth={2}
                    dash={[8, 6]}
                  />
                )
              ) : null}

              <Transformer
                ref={transformerRef}
                name="selection-transformer"
                rotateEnabled={
                  !isExporting && !pickingMode && (selection?.kind === "panel" || selection?.kind === "overlay")
                }
                resizeEnabled={
                  !isExporting &&
                  !pickingMode &&
                  (selection?.kind === "bubble" || selection?.kind === "overlay" || ellipsePanelSelected)
                }
                // 椭圆等比缩放：拖角时保持长短轴比例，不会被拉扁
                keepRatio={ellipsePanelSelected}
                flipEnabled={false}
                enabledAnchors={
                  !isExporting && !pickingMode
                    ? selection?.kind === "bubble"
                      ? BUBBLE_TRANSFORMER_ANCHORS
                      : selection?.kind === "overlay"
                        ? ALL_TRANSFORMER_ANCHORS
                        : ellipsePanelSelected
                          ? ELLIPSE_TRANSFORMER_ANCHORS
                          : []
                    : []
                }
                anchorSize={TRANSFORMER_ANCHOR_SIZE}
                // 椭圆分镜直接用 Konva 默认锚点样式：anchorStyleFunc 是闭包，
                // Konva 只在 update() 时调用它，很容易拿到过期的选中状态
                anchorStyleFunc={ellipsePanelSelected ? undefined : styleTransformerAnchor}
                borderEnabled={!isExporting && !pickingMode && selection?.kind === "bubble"}
                borderStroke="#2563eb"
                anchorStroke="#2563eb"
                anchorFill="#bfdbfe"
                rotateAnchorOffset={28}
                rotationSnaps={selection?.kind === "panel" ? ROTATION_SNAP_ANGLES : undefined}
                rotationSnapTolerance={2}
                boundBoxFunc={(oldBox, newBox) => {
                  const minSize = selection?.kind === "bubble" ? 30 : 24;
                  if (newBox.width < minSize || newBox.height < minSize) {
                    return oldBox;
                  }

                  if (liveSnapEnabled) {
                    return {
                      ...newBox,
                      width: snapSize(newBox.width, minSize),
                      height: snapSize(newBox.height, minSize)
                    };
                  }

                  return newBox;
                }}
              />
              </Layer>
            </Stage>
          </div>
        </div>
      </div>
    </div>
  );
});

export default CanvasEditor;
