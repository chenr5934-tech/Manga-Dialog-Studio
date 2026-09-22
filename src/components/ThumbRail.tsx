import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Shape, Stage } from "react-konva";
import useImage from "use-image";
import { Panel, ProjectPage } from "../types";
import { shouldPreserveImageTransparency } from "../lib/imageFormat";
import OverlayArtwork from "./OverlayArtwork";
import { getPanelRenderTransform } from "../lib/panelGeometry";
import { drawPanelPath, getPanelImageLayout } from "../lib/panelRender";
import { DEFAULT_BACKDROP_COLOR } from "../lib/project";
import { useEditorStore } from "../lib/store";
import { POOLED_IMAGE_DND_MIME, loadImageElement } from "../lib/dnd";
import { findPooledImage } from "../lib/imagePool";
import { BubbleShapeLayer, BubbleTextLayer, resolveBubbleOpacity } from "./BubbleVisual";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconPlus,
  IconTrash
} from "./icons";

const iconButtonClass =
  "studio-btn flex h-8 items-center justify-center disabled:cursor-not-allowed disabled:opacity-35";

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
        drawPanelPath(context, panel, panel.gap);
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
            <OverlayArtwork overlay={overlay} />
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
  const reorderPages = useEditorStore((state) => state.reorderPages);
  const duplicatePage = useEditorStore((state) => state.duplicatePage);
  const addPagesFromImages = useEditorStore((state) => state.addPagesFromImages);
  const uploadedImages = useEditorStore((state) => state.uploadedImages);
  const hiddenPoolImages = useEditorStore((state) => state.hiddenPoolImages);
  const setNotice = useEditorStore((state) => state.setNotice);

  // 从左侧「已导入图片」拖过来的素材，落到胶片栏就生成对应的页
  const dropMaterial = async (pooledId: string, afterPageId?: string) => {
    const pooled = findPooledImage(pooledId, uploadedImages, hiddenPoolImages);
    if (!pooled) {
      setNotice("这张素材已经不在列表里了");
      return;
    }
    try {
      const image = await loadImageElement(pooled.src);
      addPagesFromImages(
        [
          {
            name: pooled.label,
            dataUrl: pooled.src,
            width: image.naturalWidth || pooled.naturalWidth || 1200,
            height: image.naturalHeight || pooled.naturalHeight || 1600,
            mimeType: "image/png"
          }
        ],
        afterPageId
      );
    } catch {
      setNotice("读取素材失败，无法生成页面");
    }
  };

  const listRef = useRef<HTMLDivElement | null>(null);
  // 拖拽用 ref 记 id：dragstart 之后 dragover/drop 是同步来的，
  // 走 state 的话这时还没提交，读到的永远是 null
  const dragIdRef = useRef<string | null>(null);
  const dropRef = useRef<{ id: string; position: "before" | "after" } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropMark, setDropMark] = useState<{ id: string; position: "before" | "after" } | null>(null);
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
      data-thumb-rail="1"
      className="studio-surface flex h-full min-h-0 w-full flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-2.5 py-2">
        <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">胶片</span>
        <span className="studio-chip tnum px-1.5 py-0.5 text-[11px]">
          {activeIndex + 1}/{project.pages.length}
        </span>
      </div>

      <div
        ref={listRef}
        data-thumb-list="1"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(POOLED_IMAGE_DND_MIME)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          const material = event.dataTransfer.getData(POOLED_IMAGE_DND_MIME);
          if (!material) {
            return;
          }
          event.preventDefault();
          // 落在列表空白处 = 追加到末尾
          void dropMaterial(material);
          setDropMark(null);
        }}
        className="thumb-rail-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2"
      >
        {project.pages.map((page, index) => {
          const isActive = page.id === project.activePageId;
          return (
            <div
              key={page.id}
              data-thumb-index={index}
              data-page-thumb={page.id}
              draggable
              onDragStart={(event) => {
                dragIdRef.current = page.id;
                setDragId(page.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", page.id);
              }}
              onDragOver={(event) => {
                // 从左侧素材栏拖过来的图片：落在哪一页上就插到那一页后面
                if (event.dataTransfer.types.includes(POOLED_IMAGE_DND_MIME)) {
                  event.preventDefault();
                  // 必须拦住冒泡：不然外层的列表容器也会接一次，一次拖拽生成两页
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "copy";
                  setDropMark({ id: page.id, position: "after" });
                  return;
                }
                const dragging = dragIdRef.current;
                if (!dragging || dragging === page.id) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const rect = event.currentTarget.getBoundingClientRect();
                const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                dropRef.current = { id: page.id, position };
                setDropMark((prev) =>
                  prev?.id === page.id && prev.position === position ? prev : { id: page.id, position }
                );
              }}
              onDragLeave={() => {
                setDropMark((prev) => (prev?.id === page.id ? null : prev));
              }}
              onDrop={(event) => {
                event.preventDefault();
                const material = event.dataTransfer.getData(POOLED_IMAGE_DND_MIME);
                if (material) {
                  // 同理，不能让外层列表再处理一遍
                  event.stopPropagation();
                  void dropMaterial(material, page.id);
                  setDropMark(null);
                  return;
                }
                const dragging = dragIdRef.current;
                if (dragging && dragging !== page.id) {
                  reorderPages(
                    dragging,
                    page.id,
                    dropRef.current?.id === page.id ? dropRef.current.position : "before"
                  );
                }
                dragIdRef.current = null;
                dropRef.current = null;
                setDragId(null);
                setDropMark(null);
              }}
              onDragEnd={() => {
                dragIdRef.current = null;
                dropRef.current = null;
                setDragId(null);
                setDropMark(null);
              }}
              role="button"
              tabIndex={0}
              onClick={() => setActivePage(page.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActivePage(page.id);
                }
              }}
              title={`${page.name} · 分镜 ${page.panels.length} · 文字 ${page.bubbles.length}`}
              className={`thumb-card group relative flex w-full cursor-grab flex-col items-center gap-1 rounded-lg p-1.5 transition active:cursor-grabbing ${
                isActive
                  ? "thumb-card-active"
                  : "hover:bg-[var(--panel-0)]"
              }${
                dragId === page.id ? " opacity-40" : ""
              }${
                dropMark?.id === page.id
                  ? dropMark.position === "before"
                    ? " shadow-[inset_0_3px_0_0_var(--accent)]"
                    : " shadow-[inset_0_-3px_0_0_var(--accent)]"
                  : ""
              }`}
            >
              <span
                className={`tnum absolute left-1 top-1 rounded px-1 text-[11px] font-semibold leading-4 ${
                  isActive ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-1)] text-[var(--text-secondary)]"
                }`}
              >
                {index + 1}
              </span>
              <span className="overflow-hidden rounded border border-[var(--line-soft)] bg-white shadow-[0_4px_12px_rgba(2,6,23,0.28)]">
                <PageThumbnail page={page} />
              </span>
              <span className="text-[11px] text-[var(--text-secondary)]">
                分镜 {page.panels.length} · 字 {page.bubbles.length}
              </span>
            </div>
          );
        })}
      </div>

      {/* 等宽网格。原来是两行 justify-between 硬塞 4+3 个按钮，
          116px 宽的栏里每个被压到 25px —— 既难点准，符号也糊成一团。
          现在按「翻页 / 增删改序」分组，每个按钮 32px 高、宽度由网格均分；
          删除单独占满一行，红底加文字，不会和相邻按钮混掉。 */}
      <div className="grid grid-cols-3 gap-1 border-t border-[var(--line-soft)] px-2 py-2">
        <button
          type="button"
          className={iconButtonClass}
          disabled={activeIndex === 0}
          onClick={() => setActivePage(project.pages[Math.max(0, activeIndex - 1)].id)}
          title="上一页"
          aria-label="上一页"
        >
          <IconChevronUp size={15} />
        </button>
        <button
          type="button"
          className={iconButtonClass}
          disabled={activeIndex >= project.pages.length - 1}
          onClick={() => setActivePage(project.pages[Math.min(project.pages.length - 1, activeIndex + 1)].id)}
          title="下一页"
          aria-label="下一页"
        >
          <IconChevronDown size={15} />
        </button>
        <button
          type="button"
          className={iconButtonClass}
          onClick={() => addPage()}
          title="新增空白页面"
          aria-label="新增空白页面"
        >
          <IconPlus size={15} />
        </button>

        <button
          type="button"
          data-page-duplicate="1"
          className={iconButtonClass}
          onClick={() => duplicatePage(project.activePageId)}
          title="复制当前页：内容原样复制一份，插在它后面"
          aria-label="复制当前页"
        >
          <IconCopy size={15} />
        </button>
        <button
          type="button"
          className={iconButtonClass}
          disabled={activeIndex === 0}
          onClick={() => movePage(project.activePageId, "up")}
          title="上移该页"
          aria-label="上移该页"
        >
          <IconArrowUp size={15} />
        </button>
        <button
          type="button"
          className={iconButtonClass}
          disabled={activeIndex >= project.pages.length - 1}
          onClick={() => movePage(project.activePageId, "down")}
          title="下移该页"
          aria-label="下移该页"
        >
          <IconArrowDown size={15} />
        </button>

        <button
          type="button"
          className={`${iconButtonClass} studio-btn-danger col-span-3 gap-1.5 text-[12px]`}
          disabled={project.pages.length <= 1}
          onClick={() => deletePage(project.activePageId)}
          title="删除该页（至少保留一页）"
          aria-label="删除该页"
        >
          <IconTrash size={14} />
          <span>删除该页</span>
        </button>
      </div>
    </aside>
  );
}
