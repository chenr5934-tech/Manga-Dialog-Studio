import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { BubblePreset } from "../types";
import {
  IMAGE_FILE_ACCEPT,
  POOLED_IMAGE_DND_MIME,
  PRESET_DND_MIME,
  STICKER_DND_MIME,
  loadImageElement,
  readImageFileAsDataUrl
} from "../lib/dnd";
import { collectProjectImages } from "../lib/imagePool";
import { normalizePreset } from "../lib/presets";
import { getActivePage, useEditorStore } from "../lib/store";
import { StickerDef, listStickerGroups, normalizeCustomStickers } from "../lib/stickers";

type ContentMode = "presets" | "stickers" | "images" | "export";

type LeftToolPanelProps = {
  onExportPng: () => Promise<void>;
  onExportPdf: () => Promise<void>;
  onExportZip: (pixelRatio: number) => Promise<void>;
  onExportProject: () => Promise<void>;
};

type LibraryFile = { name: string; count: number; detail: string; modified: number };

const groupTitleClass = "px-0.5 text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]";
const toolButtonClass = "studio-btn h-8 px-2 text-[11px]";
const gridTwoClass = "grid grid-cols-2 gap-1.5";
const gridThreeClass = "grid grid-cols-3 gap-1.5";
const presetCardClass =
  "flex cursor-grab items-center gap-2 rounded-lg border p-1.5 transition active:cursor-grabbing";

function PresetThumb({ preset }: { preset: BubblePreset }) {
  if (preset.image) {
    return (
      <img
        src={preset.image}
        alt={preset.name}
        draggable={false}
        className="max-h-full max-w-full object-contain"
        style={{ opacity: typeof preset.opacity === "number" ? preset.opacity : 1 }}
      />
    );
  }

  const radius = preset.type === "circle" ? "9999px" : preset.type === "rounded" ? "10px" : "3px";
  return (
    <span
      className="block h-full w-full"
      style={{
        borderRadius: radius,
        background: preset.background,
        border: preset.borderWidth > 0 ? preset.borderWidth + "px solid " + preset.borderColor : "none"
      }}
    />
  );
}

function StickerPreview({ def }: { def: StickerDef }) {
  const stroked = def.mode === "stroke";
  return (
    <svg viewBox={"0 0 " + def.viewBox + " " + def.viewBox} className="h-full w-full p-1" aria-hidden="true">
      <path
        d={def.path}
        fill={stroked ? "none" : def.defaultColor}
        stroke={stroked ? def.defaultColor : "none"}
        strokeWidth={stroked ? def.strokeWidth ?? 8 : 0}
        strokeLinecap={def.lineCap ?? "round"}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LeftToolPanel({
  onExportPng,
  onExportPdf,
  onExportZip,
  onExportProject
}: LeftToolPanelProps) {
  const bubblePresets = useEditorStore((state) => state.bubblePresets);
  const project = useEditorStore((state) => state.project);
  const activePage = useEditorStore((state) => getActivePage(state.project));
  const selection = useEditorStore((state) => state.selection);
  const storyboardMode = useEditorStore((state) => state.storyboardMode);
  const manualPanelMode = useEditorStore((state) => state.manualPanelMode);
  const manualPanelShape = useEditorStore((state) => state.manualPanelShape);
  const polygonTool = useEditorStore((state) => state.polygonTool);
  const sidePanel = useEditorStore((state) => state.sidePanel);
  const customStickers = useEditorStore((state) => state.customStickers);

  const toggleManualPanelMode = useEditorStore((state) => state.toggleManualPanelMode);
  const togglePolygonTool = useEditorStore((state) => state.togglePolygonTool);
  const setBackdropColor = useEditorStore((state) => state.setBackdropColor);
  const openImportDialog = useEditorStore((state) => state.openImportDialog);
  const openTemplateLibrary = useEditorStore((state) => state.openTemplateLibrary);
  const setSidePanel = useEditorStore((state) => state.setSidePanel);
  const addBubbleFromPreset = useEditorStore((state) => state.addBubbleFromPreset);
  const deleteBubblePreset = useEditorStore((state) => state.deleteBubblePreset);
  const openPresetEditor = useEditorStore((state) => state.openPresetEditor);
  const addStickerOverlay = useEditorStore((state) => state.addStickerOverlay);
  const addCustomStickers = useEditorStore((state) => state.addCustomStickers);
  const removeCustomSticker = useEditorStore((state) => state.removeCustomSticker);
  const setNotice = useEditorStore((state) => state.setNotice);

  const [contentMode, setContentMode] = useState<ContentMode>("presets");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [zipPixelRatio, setZipPixelRatio] = useState(2);
  const [stickerGroup, setStickerGroup] = useState<string>("");
  const [libraryFiles, setLibraryFiles] = useState<LibraryFile[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stickerAdded, setStickerAdded] = useState(0);
  const bubbleInputRef = useRef<HTMLInputElement | null>(null);
  const stickerInputRef = useRef<HTMLInputElement | null>(null);

  const stickerGroups = listStickerGroups();
  const pooledImages = collectProjectImages(project);
  const customGroupName = "自定义";
  const activeStickerGroup = stickerGroup || stickerGroups[0]?.name || "";

  useEffect(() => {
    if (contentMode !== "stickers") {
      setLibraryOpen(false);
    }
  }, [contentMode]);

  const builtinPresets = bubblePresets.filter((preset) => preset.builtin);
  const userPresets = bubblePresets.filter((preset) => !preset.builtin);
  const selectedBubbleId = selection?.kind === "bubble" ? selection.id : undefined;

  const addToCanvasCenter = (preset: BubblePreset) => {
    addBubbleFromPreset(preset.id, {
      x: activePage.canvas.width / 2,
      y: activePage.canvas.height / 2
    });
  };

  // 导入的对话框素材先落成草稿预设，框选填字区域后由编辑器写进 presets/
  const handlePickBubbleImage = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      const image = await loadImageElement(dataUrl);
      const preset = normalizePreset({
        id: "user:" + uuidv4(),
        name: file.name.replace(/\.[^.]+$/, "") || "自定义气泡",
        builtin: false,
        type: "image",
        width: Math.max(40, Math.round(image.naturalWidth || 320)),
        height: Math.max(40, Math.round(image.naturalHeight || 200)),
        textBox: { x: 0.15, y: 0.15, width: 0.7, height: 0.7 },
        background: "#ffffff",
        borderColor: "#141a22",
        borderWidth: 0,
        borderRadius: 0,
        image: dataUrl,
        direction: "horizontal",
        fontSize: 30,
        fontFamily: "Noto Sans SC",
        textColor: "#141a22"
      });
      openPresetEditor({ seed: preset });
    } catch {
      setNotice("对话框图片读取失败");
    }
  };

  // 导入的贴纸立刻写进项目目录的 stickers/，下次打开直接可用
  const persistStickers = async (list: { id: string; name: string; image: string; naturalWidth: number; naturalHeight: number }[]) => {
    try {
      const name = "自定义贴纸";
      const existing = await fetch("/api/stickers/file?name=" + encodeURIComponent(name + ".json"), {
        cache: "no-store"
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      const merged = normalizeCustomStickers([...(existing?.stickers ?? []), ...list]);
      await fetch("/api/stickers/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content: JSON.stringify({ name, stickers: merged }, null, 2) })
      });
    } catch {
      setNotice("贴纸已导入，但写入 stickers/ 失败");
    }
  };

  const handleImportStickers = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const imported: { id: string; name: string; image: string; naturalWidth: number; naturalHeight: number }[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        continue;
      }
      try {
        const dataUrl = await readImageFileAsDataUrl(file);
        const image = await loadImageElement(dataUrl);
        imported.push({
          id: "custom-" + uuidv4(),
          name: file.name.replace(/\.[^.]+$/, "") || "自定义贴纸",
          image: dataUrl,
          naturalWidth: image.naturalWidth || 100,
          naturalHeight: image.naturalHeight || 100
        });
      } catch {
        setNotice("贴纸导入失败：" + file.name);
      }
    }

    if (imported.length === 0) {
      return;
    }

    addCustomStickers(imported);
    setStickerGroup(customGroupName);
    setNotice("已导入 " + imported.length + " 张贴纸，并存进 stickers/");
    await persistStickers(imported);
  };

  const refreshStickerLibrary = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/stickers", { cache: "no-store" });
      const payload = await response.json();
      setLibraryFiles(Array.isArray(payload?.files) ? payload.files : []);
      setLibraryOpen(true);
    } catch {
      setNotice("读取贴纸库失败");
    } finally {
      setBusy(false);
    }
  };

  const loadStickerLibraryFile = async (name: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/stickers/file?name=" + encodeURIComponent(name), { cache: "no-store" });
      const payload = await response.json();
      const incoming = normalizeCustomStickers(payload?.stickers);
      const existing = new Set(customStickers.map((item) => item.image));
      const fresh = incoming.filter((item) => !existing.has(item.image));
      addCustomStickers(fresh);
      setStickerGroup(customGroupName);
      setNotice("已载入 " + fresh.length + " 张贴纸");
    } catch {
      setNotice("载入失败");
    } finally {
      setBusy(false);
    }
  };

  const renderPresetCard = (preset: BubblePreset) => (
    <div
      key={preset.id}
      data-preset-id={preset.id}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(PRESET_DND_MIME, preset.id);
        event.dataTransfer.effectAllowed = "copy";
        setDraggingId(preset.id);
      }}
      onDragEnd={() => setDraggingId(null)}
      onClick={() => addToCanvasCenter(preset)}
      title="单击加到画布中央；也可以直接拖到画布上指定位置"
      className={
        presetCardClass +
        " " +
        (draggingId === preset.id
          ? "border-[var(--accent)] bg-[var(--accent-soft)] opacity-60"
          : "border-[var(--line-soft)] bg-[var(--panel-1)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-0)]")
      }
    >
      <span className="preset-thumb checker-bg flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded p-0.5">
        <PresetThumb preset={preset} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold text-[var(--text-primary)]">{preset.name}</span>
        <span className="block text-[10px] text-[var(--text-secondary)]">
          {preset.width}×{preset.height}
          {preset.builtin ? "" : " · 自定义"}
        </span>
      </span>
      {!preset.builtin && (
        <button
          type="button"
          title="删除该预设"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (window.confirm("删除预设「" + preset.name + "」？")) {
              deleteBubblePreset(preset.id);
            }
          }}
          className="studio-btn h-6 w-6 shrink-0 text-[11px] opacity-0 transition group-hover:opacity-100"
        >
          ✕
        </button>
      )}
    </div>
  );

  const stickerItems =
    activeStickerGroup === customGroupName
      ? []
      : stickerGroups.find((group) => group.name === activeStickerGroup)?.items ?? [];

  return (
    <aside className="studio-surface flex h-full min-h-0 flex-col overflow-hidden">
      <div className="space-y-2.5 border-b border-[var(--line-soft)] px-2.5 py-2.5">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">工具箱</p>

        <div className="space-y-1.5">
          <p className={groupTitleClass}>扣选</p>
          <div className={gridThreeClass}>
            <button
              type="button"
              data-tool="panel-rect"
              className={
                toolButtonClass +
                (manualPanelMode && manualPanelShape === "rect" && storyboardMode === "storyboard"
                  ? " studio-btn-primary"
                  : "")
              }
              onClick={() => toggleManualPanelMode(!(manualPanelMode && manualPanelShape === "rect"), "rect")}
              title="在画布上拖拽扣出矩形分镜"
            >
              矩形
            </button>
            <button
              type="button"
              data-tool="panel-polygon"
              className={toolButtonClass + (polygonTool ? " studio-btn-primary" : "")}
              onClick={() => togglePolygonTool(!polygonTool)}
              title="单击加点，回到起点或按 Enter 闭合"
            >
              多边形
            </button>
            <button
              type="button"
              data-tool="panel-ellipse"
              className={
                toolButtonClass +
                (manualPanelMode && manualPanelShape === "ellipse" && storyboardMode === "storyboard"
                  ? " studio-btn-primary"
                  : "")
              }
              onClick={() => toggleManualPanelMode(!(manualPanelMode && manualPanelShape === "ellipse"), "ellipse")}
              title="拖拽扣出圆形（椭圆）分镜，用于圆形取景"
            >
              圆形
            </button>
          </div>
          <label className={toolButtonClass + " flex w-full cursor-pointer items-center justify-between"}>
            <span className="text-[11px]">底图色</span>
            <input
              type="color"
              data-tool-backdrop="1"
              className="h-5 w-10 cursor-pointer border-0 bg-transparent p-0"
              value={activePage.backdropColor ?? "#ffffff"}
              onChange={(event) => setBackdropColor(event.target.value)}
              title="整页底色，默认白色并铺满编辑区"
            />
          </label>
        </div>

        <div className="space-y-1.5">
          <p className={groupTitleClass}>保存</p>
          <div className={gridTwoClass}>
            <button
              type="button"
              data-tool="import-images"
              className={toolButtonClass + " studio-btn-primary"}
              onClick={() => openImportDialog()}
              title="按顺序多选导入漫画原稿，每张图片成为一个页面"
            >
              导入图片
            </button>
            <button
              type="button"
              data-tool="export"
              className={toolButtonClass + (contentMode === "export" ? " studio-btn-primary" : "")}
              onClick={() => setContentMode("export")}
              title="导出 PNG / PDF / 图片 ZIP"
            >
              导出
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className={groupTitleClass}>辅助</p>
          <div className={gridTwoClass}>
            <button
              type="button"
              data-tool="agent"
              data-agent-toggle="1"
              className={toolButtonClass + (sidePanel === "agent" ? " studio-btn-primary" : "")}
              onClick={() => setSidePanel(sidePanel === "agent" ? "inspector" : "agent")}
              title="Agent 模式：用一句话描述想要的排版"
            >
              Agent
            </button>
            <button
              type="button"
              data-tool="template"
              data-open-template-library="1"
              className={toolButtonClass}
              onClick={() => openTemplateLibrary()}
              title="整册版式模板：保存当前排版，或从模板新建后只替换画面"
            >
              模板
            </button>
            <button
              type="button"
              data-tool="stickers"
              className={toolButtonClass + (contentMode === "stickers" ? " studio-btn-primary" : "")}
              onClick={() => setContentMode("stickers")}
              title="贴纸：内置 26 个，也可以导入自己的图片"
            >
              贴纸
            </button>
            <button
              type="button"
              data-tool="presets"
              className={toolButtonClass + (contentMode === "presets" ? " studio-btn-primary" : "")}
              onClick={() => setContentMode("presets")}
              title="对话框预设：单击加到画布，也可以拖到画布指定位置"
            >
              对话框预设
            </button>
            <button
              type="button"
              data-tool="images"
              className={toolButtonClass + (contentMode === "images" ? " studio-btn-primary" : "")}
              onClick={() => setContentMode("images")}
              title="项目里已经导入过的图片，可以拖进分镜或拖到画布上层"
            >
              已导入图片 {pooledImages.length > 0 ? "(" + pooledImages.length + ")" : ""}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5" data-tool-content={contentMode}>
        {contentMode === "presets" ? (
          <div className="space-y-3">
            <p className="text-[10px] leading-4 text-[var(--text-secondary)]">
              <span className="text-[var(--text-primary)]">单击</span>加到画布中央，或
              <span className="text-[var(--text-primary)]">拖到画布</span>指定位置
            </p>
            {userPresets.length > 0 && (
              <section className="space-y-1.5">
                <p className={groupTitleClass}>自定义 {userPresets.length}</p>
                {userPresets.map(renderPresetCard)}
              </section>
            )}
            <section className="space-y-1.5">
              <p className={groupTitleClass}>内置 {builtinPresets.length}</p>
              {builtinPresets.map(renderPresetCard)}
            </section>
          </div>
        ) : null}

        {contentMode === "stickers" ? (
          <div className="space-y-2.5" data-sticker-picker="1">
            <div className="flex flex-wrap gap-1.5">
              {stickerGroups.map((group) => (
                <button
                  key={group.name}
                  type="button"
                  data-sticker-group={group.name}
                  className={toolButtonClass + (group.name === activeStickerGroup ? " studio-btn-primary" : "")}
                  onClick={() => setStickerGroup(group.name)}
                >
                  {group.name}
                </button>
              ))}
              <button
                type="button"
                data-sticker-group={customGroupName}
                className={toolButtonClass + (activeStickerGroup === customGroupName ? " studio-btn-primary" : "")}
                onClick={() => setStickerGroup(customGroupName)}
              >
                自定义 {customStickers.length > 0 ? "(" + customStickers.length + ")" : ""}
              </button>
            </div>

            {activeStickerGroup === customGroupName && customStickers.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" data-sticker-load-library="1" className={toolButtonClass} disabled={busy} onClick={() => void refreshStickerLibrary()}>
                  从贴纸库载入
                </button>
                <button type="button" className={toolButtonClass} onClick={() => void fetch("/api/stickers/reveal", { method: "POST" })}>
                  打开文件夹
                </button>
              </div>
            ) : null}

            {libraryOpen ? (
              <div className="max-h-[120px] space-y-1 overflow-y-auto rounded-xl border border-[var(--line-soft)] p-2">
                {libraryFiles.length === 0 ? (
                  <p className="px-1 text-[11px] text-[var(--text-secondary)]">贴纸库还是空的</p>
                ) : (
                  libraryFiles.map((file) => (
                    <div key={file.name} className="flex items-center justify-between gap-2 px-1">
                      <span className="min-w-0 flex-1 truncate text-[11px]" title={file.name}>{file.name}</span>
                      <button type="button" data-sticker-library-load={file.name} className="studio-btn h-6 shrink-0 px-2 text-[10px]" onClick={() => void loadStickerLibraryFile(file.name)}>
                        载入
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <div className="grid grid-cols-4 gap-1.5">
              {activeStickerGroup === customGroupName
                ? customStickers.map((item) => (
                    <div
                      key={item.id}
                      className="group relative flex aspect-square items-center justify-center rounded-lg border border-[var(--line-soft)] bg-[var(--panel-1)]"
                    >
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(STICKER_DND_MIME, item.id);
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                        data-sticker-id={item.id}
                        title={item.name + "（单击加到中央，也可以拖到画布指定位置）"}
                        className="h-full w-full cursor-grab p-1 active:cursor-grabbing"
                        onClick={() => {
                          addStickerOverlay(item.id);
                          setStickerAdded((current) => current + 1);
                        }}
                      >
                        <img src={item.image} alt={item.name} className="h-full w-full object-contain" draggable={false} />
                      </button>
                      <button
                        type="button"
                        data-sticker-remove={item.id}
                        title="删除这张贴纸"
                        className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded-full bg-[var(--panel-1)] text-[10px] text-[var(--text-secondary)] group-hover:flex hover:text-red-500"
                        onClick={() => removeCustomSticker(item.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))
                : stickerItems.map((def) => (
                    <button
                      key={def.id}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(STICKER_DND_MIME, def.id);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      data-sticker-id={def.id}
                      title={def.name + "（单击加到中央，也可以拖到画布指定位置）"}
                      className="flex aspect-square cursor-grab items-center justify-center rounded-lg border border-[var(--line-soft)] bg-[var(--panel-1)] transition hover:border-cyan-300/70 hover:bg-cyan-500/10 active:cursor-grabbing"
                      onClick={() => {
                        addStickerOverlay(def.id);
                        setStickerAdded((current) => current + 1);
                      }}
                    >
                      <StickerPreview def={def} />
                    </button>
                  ))}
            </div>

            <p className="text-[10px] text-[var(--text-secondary)]" data-sticker-count="1">
              单击即加到画布中央，可连续添加 · 已添加 {stickerAdded}
            </p>

            {activeStickerGroup === customGroupName && customStickers.length === 0 ? (
              <p className="py-4 text-center text-[11px] leading-5 text-[var(--text-secondary)]">
                还没有自定义贴纸。
                <br />
                点下面的「导入自定义贴纸」试试，透明底 PNG 效果最好。
              </p>
            ) : null}
          </div>
        ) : null}

        {contentMode === "images" ? (
          <div className="space-y-2.5" data-image-pool="1">
            <p className="text-[10px] leading-4 text-[var(--text-secondary)]">
              拖到<span className="text-[var(--text-primary)]">分镜</span>上会问你是否放进该格子；
              拖到<span className="text-[var(--text-primary)]">空白处</span>则在上层新建一张图片，可以自由调大小。
            </p>

            {pooledImages.length === 0 ? (
              <p className="py-4 text-center text-[11px] leading-5 text-[var(--text-secondary)]">
                还没有图片。
                <br />
                导入漫画原稿、或给分镜放进图片之后，它们会出现在这里。
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {pooledImages.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(POOLED_IMAGE_DND_MIME, item.id);
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    data-pooled-image={item.id}
                    title={item.label + "（" + item.detail + "）"}
                    className="flex aspect-square cursor-grab items-center justify-center overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--panel-1)] transition hover:border-cyan-300/70 active:cursor-grabbing"
                  >
                    <img src={item.src} alt={item.label} className="h-full w-full object-cover" draggable={false} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {contentMode === "export" ? (
          <div className="space-y-3">
            <p className={groupTitleClass}>导出</p>
            <div className="space-y-1.5">
              <button type="button" className={toolButtonClass + " w-full studio-btn-primary"} onClick={() => void onExportPng()}>
                导出 PNG（当前页）
              </button>
              <button type="button" className={toolButtonClass + " w-full studio-btn-primary"} onClick={() => void onExportPdf()}>
                导出 PDF（全部页）
              </button>
              <button type="button" data-export-zip="1" className={toolButtonClass + " w-full studio-btn-primary"} onClick={() => void onExportZip(zipPixelRatio)}>
                导出图片 ZIP（全部页）
              </button>
            </div>
            <div className="space-y-1.5">
              <p className={groupTitleClass}>图片倍率</p>
              <div className="flex overflow-hidden rounded-lg border border-[var(--line-soft)]">
                {[1, 2].map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className={"studio-btn h-8 flex-1 rounded-none border-0 text-xs " + (zipPixelRatio === ratio ? "studio-btn-primary" : "")}
                    onClick={() => setZipPixelRatio(ratio)}
                  >
                    {ratio}x
                  </button>
                ))}
              </div>
              <p className="text-[10px] leading-4 text-[var(--text-secondary)]">每页一张 PNG，按 001、002 序号命名</p>
            </div>

            <div className="space-y-1.5 border-t border-[var(--line-soft)] pt-3">
              <p className={groupTitleClass}>接续编辑</p>
              <button
                type="button"
                data-export-project="1"
                className={toolButtonClass + " w-full studio-btn-primary"}
                onClick={() => void onExportProject()}
                title="把当前作品打包成一个自包含文件下载下来，图片与编辑历史都内嵌其中；下次用「加载项目」打开就能接着改"
              >
                导出未完成作品
              </button>
              <p className="text-[10px] leading-4 text-[var(--text-secondary)]">
                保存目前所有改动（含图片与编辑历史）成一个文件，方便下次接着编辑。
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-[var(--line-soft)] px-2.5 py-2.5">
        {contentMode === "presets" ? (
          <div className="space-y-1.5">
            <button
              type="button"
              data-import-bubble-image="1"
              className={toolButtonClass + " w-full studio-btn-primary"}
              onClick={() => bubbleInputRef.current?.click()}
              title="导入自定义对话框图片，框选填字区域后存成预设，写进 presets/ 反复套用"
            >
              导入自定义对话框
            </button>
            <div className={gridTwoClass}>
              <button
                type="button"
                className={toolButtonClass}
                disabled={!selectedBubbleId}
                onClick={() => openPresetEditor({ bubbleId: selectedBubbleId })}
                title={selectedBubbleId ? "编辑选中气泡的填字区域" : "请先在画布上选中一个气泡"}
              >
                编辑填字区
              </button>
              <button
                type="button"
                className={toolButtonClass}
                onClick={() => openPresetEditor()}
                title="从空白开始做一个对话框预设"
              >
                新建预设
              </button>
            </div>
          </div>
        ) : null}

        {contentMode === "stickers" ? (
          <div className={gridTwoClass}>
            <button
              type="button"
              data-sticker-import="1"
              className={toolButtonClass + " studio-btn-primary"}
              onClick={() => stickerInputRef.current?.click()}
              title="导入自己的图片做贴纸，透明底 PNG 最好，可一次选多张；导入后自动存进 stickers/"
            >
              导入自定义贴纸
            </button>
            <button type="button" className={toolButtonClass} onClick={() => void fetch("/api/stickers/reveal", { method: "POST" })}>
              打开文件夹
            </button>
          </div>
        ) : null}

        {contentMode === "export" ? (
          <p className="px-0.5 text-[10px] leading-4 text-[var(--text-secondary)]">
            导出会把当前选中状态与辅助线一并排除，只输出画面内容。
          </p>
        ) : null}

        {contentMode === "images" ? (
          <p className="px-0.5 text-[10px] leading-4 text-[var(--text-secondary)]">
            图片池收录项目里用过的每一张图，自动去重。拖拽即可复用，不需要重新导入。
          </p>
        ) : null}
      </div>

      <input
        ref={bubbleInputRef}
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        className="hidden"
        data-bubble-file-input="1"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void handlePickBubbleImage(file);
        }}
      />
      <input
        ref={stickerInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-sticker-file-input="1"
        onChange={(event) => {
          // FileList 是活引用：先固化成数组再清空 input
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void handleImportStickers(files);
        }}
      />
    </aside>
  );
}