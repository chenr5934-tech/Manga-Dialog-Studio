import { useEffect, useMemo, useRef } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Shape, Stage } from "react-konva";
import useImage from "use-image";
import { OverlayImage, Panel, ProjectPage } from "../types";
import { shouldPreserveImageTransparency } from "../lib/imageFormat";
import { getPanelRenderTransform } from "../lib/panelGeometry";
import { drawPanelPath, getPanelImageLayout } from "../lib/panelRender";
import { DEFAULT_BACKDROP_COLOR } from "../lib/project";
import { useEditorStore } from "../lib/store";
import { BubbleShapeLayer, BubbleTextLayer, resolveBubbleOpacity } from "./BubbleVisual";

const iconButtonClass =
  "studio-btn flex h-7 w-7 items-center justify-center text-xs disabled:cursor-not-allowed disabled:opacity-35";

const RAIL_WIDTH = 128;
const THUMB_MAX_WIDTH = 92;
const THUMB_MAX_HEIGHT = 132;

function PreviewPanelFill({ panel }: { panel: Panel }) {
  if (shouldPreserveImageTransparency(panel.image)) {
    return null;
  }

  return (
    <Shape
      sceneFunc={(context, shape) => {
        context.beginPath();
        drawPanelPath(context, panel);
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      fill="#ffffff"
      listening={false}
    />
  );
}

function PreviewPanelBorder({ panel }: { panel: Panel }) {
  return (
    <Shape
      sceneFunc={(context, shape) => {
        context.beginPath();
        drawPanelPath(context, panel);
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      fillEnabled={false}
      stroke={panel.borderColor}
      strokeWidth={panel.borderWidth}
      listening={false}
    />
  );
}

function PreviewPanelImage({ panel }: { panel: Panel }) {
  const [image] = useImage(panel.image?.original ?? "", "anonymous");

  if (!image || !panel.image) {
    return null;
  }

  const layout = getPanelImageLayout(panel, { width: image.width, height: image.height });
  if (!layout) {
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
        x={layout.offsetX}
        y={layout.offsetY}
        width={layout.drawWidth}
        height={layout.drawHeight}
        crop={layout.cropRect}
        listening={false}
      />
    </Group>
  );
}

function OverlayThumbImage({ overlay }: { overlay: OverlayImage }) {
  const [image] = useImage(overlay.image, "anonymous");
  if (!image) {
    return null;
  }
  return (
    <KonvaImage image={image} x={0} y={0} width={overlay.width} height={overlay.height} listening={false} />
  );
}

function PageThumbnail({ page }: { page: ProjectPage }) {
  const [backgroundImage] = useImage(page.background?.original ?? "", "anonymous");

  const geometry = useMemo(() => {
    const scale = Math.min(1, THUMB_MAX_WIDTH / page.canvas.width, THUMB_MAX_HEIGHT / page.canvas.height);
    return {
      scale,
      width: Math.max(48, Math.round(page.canvas.width * scale)),
      height: Math.max(64, Math.round(page.canvas.height * scale))
    };
  }, [page.canvas.height, page.canvas.width]);

  return (
    <Stage
      width={geometry.width}
      height={geometry.height}
      scaleX={geometry.scale}
      scaleY={geometry.scale}
      className="pointer-events-none"
    >
      <Layer listening={false}>
        <Rect
          x={0}
          y={0}
          width={page.canvas.width}
          height={page.canvas.height}
          fill={page.backdropColor ?? DEFAULT_BACKDROP_COLOR}
          listening={false}
        />

        {backgroundImage && page.background ? (
          <KonvaImage
            image={backgroundImage}
            x={0}
            y={0}
            width={page.canvas.width}
            height={page.canvas.height}
            listening={false}
          />
        ) : null}

        {page.panels.map((panel) => {
          const transform = getPanelRenderTransform(panel);
          return (
            <Group
              key={panel.id}
              x={transform.x}
              y={transform.y}
              width={panel.width}
              height={panel.height}
              offsetX={transform.offsetX}
              offsetY={transform.offsetY}
              rotation={transform.rotation}
              listening={false}
            >
              <PreviewPanelFill panel={panel} />
              <PreviewPanelImage panel={panel} />
              <PreviewPanelBorder panel={panel} />
            </Group>
          );
        })}

        {(page.overlays ?? []).map((overlay) => (
          <Group
            key={overlay.id}
            x={overlay.x + overlay.width / 2}
            y={overlay.y + overlay.height / 2}
            width={overlay.width}
            height={overlay.height}
            offsetX={overlay.width / 2}
            offsetY={overlay.height / 2}
            rotation={overlay.rotation}
            opacity={overlay.opacity ?? 1}
            listening={false}
          >
            <OverlayThumbImage overlay={overlay} />
          </Group>
        ))}

        {page.bubbles.map((bubble) => (
          <Group
            key={bubble.id}
            x={bubble.x}
            y={bubble.y}
            width={bubble.width}
            height={bubble.height}
            opacity={resolveBubbleOpacity(bubble)}
            listening={false}
          >
            <BubbleShapeLayer bubble={bubble} listening={false} />
            <BubbleTextLayer bubble={bubble} listening={false} />
          </Group>
        ))}
      </Layer>
    </Stage>
  );
}

export default function ThumbRail() {
  const project = useEditorStore((state) => state.project);
  const setActivePage = useEditorStore((state) => state.setActivePage);
  const addPage = useEditorStore((state) => state.addPage);
  const deletePage = useEditorStore((state) => state.deletePage);
  const movePage = useEditorStore((state) => state.movePage);

  const listRef = useRef<HTMLDivElement | null>(null);
  const activeIndex = Math.max(
    0,
    project.pages.findIndex((page) => page.id === project.activePageId)
  );

  // 滚轮优先滚动列表；列表不可滚动或已到两端时，转为上一页/下一页
  useEffect(() => {
    const element = listRef.current;
    if (!element) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      const canScroll = element.scrollHeight > element.clientHeight + 1;
      const atTop = element.scrollTop <= 0;
      const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
      const scrollUp = event.deltaY < 0;
      const reachedEdge = canScroll && ((scrollUp && atTop) || (!scrollUp && atBottom));

      if (canScroll && !reachedEdge) {
        return;
      }

      const direction = scrollUp ? -1 : 1;
      const target = Math.min(project.pages.length - 1, Math.max(0, activeIndex + direction));
      if (target !== activeIndex) {
        event.preventDefault();
        setActivePage(project.pages[target].id);
      }
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [activeIndex, project.pages, setActivePage]);

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-thumb-index="${activeIndex}"]`);
    element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  return (
    <aside
      className="studio-surface flex h-full min-h-0 flex-col overflow-hidden"
      style={{ width: RAIL_WIDTH }}
    >
      <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-2.5 py-2">
        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">胶片</span>
        <span className="studio-chip px-1.5 py-0.5 text-[10px]">
          {activeIndex + 1}/{project.pages.length}
        </span>
      </div>

      <div ref={listRef} className="thumb-rail-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2">
        {project.pages.map((page, index) => {
          const isActive = page.id === project.activePageId;
          return (
            <button
              key={page.id}
              type="button"
              data-thumb-index={index}
              onClick={() => setActivePage(page.id)}
              title={`${page.name} · 分镜 ${page.panels.length} · 文字 ${page.bubbles.length}`}
              className={`thumb-card group relative flex w-full flex-col items-center gap-1 rounded-lg p-1.5 transition ${
                isActive
                  ? "thumb-card-active"
                  : "hover:bg-[var(--panel-0)]"
              }`}
            >
              <span
                className={`absolute left-1 top-1 rounded px-1 text-[10px] font-semibold leading-4 ${
                  isActive ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-1)] text-[var(--text-secondary)]"
                }`}
              >
                {index + 1}
              </span>
              <span className="overflow-hidden rounded border border-[var(--line-soft)] bg-white shadow-[0_4px_12px_rgba(2,6,23,0.28)]">
                <PageThumbnail page={page} />
              </span>
              <span className="text-[10px] text-[var(--text-secondary)]">
                分镜 {page.panels.length} · 字 {page.bubbles.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-1 border-t border-[var(--line-soft)] px-2 py-2">
        <button
          type="button"
          className={iconButtonClass}
          disabled={activeIndex === 0}
          onClick={() => setActivePage(project.pages[Math.max(0, activeIndex - 1)].id)}
          title="上一页"
        >
          ▲
        </button>
        <button type="button" className={iconButtonClass} onClick={() => addPage()} title="新增页面">
          ＋
        </button>
        <button
          type="button"
          className={iconButtonClass}
          disabled={activeIndex >= project.pages.length - 1}
          onClick={() => setActivePage(project.pages[Math.min(project.pages.length - 1, activeIndex + 1)].id)}
          title="下一页"
        >
          ▼
        </button>
      </div>

      <div className="flex items-center justify-between gap-1 border-t border-[var(--line-soft)] px-2 py-2">
        <button
          type="button"
          className={iconButtonClass}
          disabled={activeIndex === 0}
          onClick={() => movePage(project.activePageId, "up")}
          title="上移该页"
        >
          ↥
        </button>
        <button
          type="button"
          className={`${iconButtonClass} studio-btn-danger`}
          disabled={project.pages.length <= 1}
          onClick={() => deletePage(project.activePageId)}
          title="删除该页"
        >
          ✕
        </button>
        <button
          type="button"
          className={iconButtonClass}
          disabled={activeIndex >= project.pages.length - 1}
          onClick={() => movePage(project.activePageId, "down")}
          title="下移该页"
        >
          ↧
        </button>
      </div>
    </aside>
  );
}
