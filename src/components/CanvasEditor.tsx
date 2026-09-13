import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { Circle, Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Shape, Stage, Text, Transformer } from "react-konva";
import useImage from "use-image";
import { Bubble, Panel, ProjectPage } from "../types";
import { shouldPreserveImageTransparency } from "../lib/imageFormat";
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
  normalizePanelRotation,
  normalizePanelShape,
  updatePanelEdgeHandle,
  updatePanelShapeHandle
} from "../lib/panelGeometry";
import { drawPanelPath, getPanelImageLayout } from "../lib/panelRender";
import { DEFAULT_BACKDROP_COLOR } from "../lib/project";
import { PRESET_DND_MIME } from "../lib/dnd";
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

const SKEW_HANDLE_RADIUS = 15;
const SKEW_HANDLE_HIT_RADIUS = 30;
const SKEW_HANDLE_HIT_STROKE_WIDTH = 42;
const EDGE_HANDLE_SIZE = 42;
const EDGE_HANDLE_HIT_STROKE_WIDTH = 42;
const EDGE_HANDLE_CORNER_RADIUS = 8;
const SKEW_HANDLE_COLOR = "#2563eb";
const SKEW_GUIDE_COLOR = "rgba(37, 99, 235, 0.35)";
const TRANSFORMER_ANCHOR_SIZE = 18;

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
      sceneFunc={(context, shape) => {
        context.beginPath();
        drawPanelPath(context, panel);
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
  const snapSizeTo16 = useEditorStore((state) => state.snapSizeTo16);

  const setNotice = useEditorStore((state) => state.setNotice);
  const setActivePage = useEditorStore((state) => state.setActivePage);
  const selectPanel = useEditorStore((state) => state.selectPanel);
  const selectBubble = useEditorStore((state) => state.selectBubble);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const updatePanel = useEditorStore((state) => state.updatePanel);
  const updateBubble = useEditorStore((state) => state.updateBubble);
  const createPanelFromRect = useEditorStore((state) => state.createPanelFromRect);
  const addBubbleFromPreset = useEditorStore((state) => state.addBubbleFromPreset);
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

  const selectedNodeId = useMemo(() => {
    if (!selection) {
      return null;
    }

    if (selection.kind === "panel") {
      return `panel-${selection.id}`;
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
  const styleTransformerAnchor = (anchor: Konva.Rect) => {
    if (selection?.kind !== "panel") {
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
        setPolygonPoints([]);
        setNotice("已放弃当前多边形");
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
  }, [createPolygonPanelFromPoints, polygonPoints, polygonTool, setNotice]);

  const beginManualPanel = (position: { x: number; y: number }) => {
    const scenePoint = toScene(position);
    setDraftStart(scenePoint);
    setDraftRect({ x: scenePoint.x, y: scenePoint.y, width: 0, height: 0 });
  };

  const handleMouseDown = (event: any) => {
    const stage = stageRef.current;
    if (!stage) {
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
    const onTransformer = Boolean(target?.findAncestor?.(".selection-transformer", true));
    const onSkewHandle = Boolean(target?.findAncestor?.(".panel-skew-handle", true) || target?.findAncestor?.(".panel-skew-overlay", true));
    if (onPanel || onBubble || onTransformer || onSkewHandle) {
      return;
    }

    if (manualPanelMode) {
      const pointer = stage.getPointerPosition();
      if (!pointer) {
        return;
      }
      beginManualPanel(pointer);
      return;
    }

    clearSelection();
  };

  const handleMouseMove = () => {
    if (!manualPanelMode || !draftStart || !stageRef.current) {
      return;
    }

    const pointer = stageRef.current.getPointerPosition();
    if (!pointer) {
      return;
    }

    const scenePoint = toScene(pointer);
    setDraftRect({
      x: draftStart.x,
      y: draftStart.y,
      width: scenePoint.x - draftStart.x,
      height: scenePoint.y - draftStart.y
    });
  };

  const handleMouseUp = () => {
    if (!manualPanelMode || !draftRect) {
      setDraftStart(null);
      return;
    }

    createPanelFromRect(draftRect.x, draftRect.y, draftRect.width, draftRect.height);
    setDraftRect(null);
    setDraftStart(null);
  };

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
          <label className="text-[11px] text-[var(--text-secondary)]">缩放 {Math.round(zoom * 100)}%</label>
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

      <div className="min-h-0 overflow-auto">
        <div className="studio-workspace min-w-fit p-6 lg:p-8">
          <div
            className="relative overflow-hidden rounded-xl border border-slate-300/90 bg-slate-100 shadow-[0_28px_70px_rgba(2,6,23,0.4)]"
            style={{
              width: Math.ceil(activePage.canvas.width * zoom),
              height: Math.ceil(activePage.canvas.height * zoom)
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(PRESET_DND_MIME)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(event) => {
              const presetId = event.dataTransfer.getData(PRESET_DND_MIME);
              if (!presetId) {
                return;
              }

              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              const scenePoint = toScene({
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
              });
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
              onMouseUp={handleMouseUp}
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
                      x={transform.x}
                      y={transform.y}
                      width={displayPanel.width}
                      height={displayPanel.height}
                      offsetX={transform.offsetX}
                      offsetY={transform.offsetY}
                      rotation={transform.rotation}
                      draggable
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

                    {selected && !displayPanel.points ? (
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

              {activePage.bubbles.map((bubble) => {
                const selected = !isExporting && selection?.kind === "bubble" && selection.id === bubble.id;
                return (
                  <Group
                    key={bubble.id}
                    id={`bubble-${bubble.id}`}
                    name="bubble-node"
                    x={bubble.x}
                    y={bubble.y}
                    width={bubble.width}
                    height={bubble.height}
                    opacity={resolveBubbleOpacity(bubble)}
                    draggable
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
                      let nextWidth = Math.max(30, node.width() * node.scaleX());
                      let nextHeight = Math.max(30, node.height() * node.scaleY());
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

              {draftRect && manualPanelMode && (
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
              )}

              <Transformer
                ref={transformerRef}
                name="selection-transformer"
                rotateEnabled={!isExporting && selection?.kind === "panel"}
                resizeEnabled={!isExporting && selection?.kind === "bubble"}
                flipEnabled={false}
                enabledAnchors={!isExporting && selection?.kind === "bubble" ? BUBBLE_TRANSFORMER_ANCHORS : []}
                anchorSize={TRANSFORMER_ANCHOR_SIZE}
                keepRatio={false}
                anchorStyleFunc={styleTransformerAnchor}
                borderEnabled={!isExporting && selection?.kind === "bubble"}
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
