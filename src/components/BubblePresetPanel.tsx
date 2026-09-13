import { useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { BubblePreset } from "../types";
import { IMAGE_FILE_ACCEPT, loadImageElement, PRESET_DND_MIME, readImageFileAsDataUrl } from "../lib/dnd";
import { normalizePreset } from "../lib/presets";
import { getActivePage, useEditorStore } from "../lib/store";

const actionButtonClass =
  "studio-btn h-7 flex-1 px-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-40";

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
        borderColor: preset.borderColor,
        borderWidth: Math.min(5, Math.max(1, preset.borderWidth || 1)),
        borderStyle: "solid",
        opacity: typeof preset.opacity === "number" ? preset.opacity : 1
      }}
    />
  );
}

export default function BubblePresetPanel() {
  const bubblePresets = useEditorStore((state) => state.bubblePresets);
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const addBubbleFromPreset = useEditorStore((state) => state.addBubbleFromPreset);
  const deleteBubblePreset = useEditorStore((state) => state.deleteBubblePreset);
  const openPresetEditor = useEditorStore((state) => state.openPresetEditor);
  const openPresetLibrary = useEditorStore((state) => state.openPresetLibrary);
  const exportBubblePresets = useEditorStore((state) => state.exportBubblePresets);
  const setNotice = useEditorStore((state) => state.setNotice);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const builtinPresets = bubblePresets.filter((preset) => preset.builtin);
  const userPresets = bubblePresets.filter((preset) => !preset.builtin);
  const selectedBubbleId = selection?.kind === "bubble" ? selection.id : undefined;

  const addToCanvasCenter = (preset: BubblePreset) => {
    const activePage = getActivePage(project);
    addBubbleFromPreset(preset.id, {
      x: activePage.canvas.width / 2,
      y: activePage.canvas.height / 2
    });
  };

  // 导入的对话框素材先落成草稿预设，再由预设编辑器框选填字区域后才入库
  const handlePickImage = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      const image = await loadImageElement(dataUrl);
      const preset = normalizePreset({
        id: `user:${uuidv4()}`,
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

  // 一键把当前整套预设写进预设库文件夹，省去先开窗再保存的步骤
  const handleQuickSave = async () => {
    if (userPresets.length === 0) {
      setNotice("还没有自定义预设，先做一个再保存");
      return;
    }

    const suggested = "我的对话框预设";
    const name = window.prompt("保存到预设库的文件名", suggested);
    if (!name || !name.trim()) {
      return;
    }

    try {
      const response = await fetch("/api/presets/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), content: exportBubblePresets() })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "保存失败");
      }
      setNotice("已保存 " + userPresets.length + " 个预设到预设库");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "保存失败");
    }
  };

  const handleExportJson = () => {
    const json = exportBubblePresets();
    const parsed = JSON.parse(json) as { presets?: unknown[] };
    if (!parsed.presets || parsed.presets.length === 0) {
      setNotice("还没有自定义预设可导出");
      return;
    }

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dialog-presets.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`已导出 ${parsed.presets.length} 个预设`);
  };

  const renderCard = (preset: BubblePreset) => (
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
      onDoubleClick={() => addToCanvasCenter(preset)}
      title="拖到画布放置，双击加到画布中央"
      className={`group flex cursor-grab items-center gap-2 rounded-lg border p-1.5 transition active:cursor-grabbing ${
        draggingId === preset.id
          ? "border-[var(--accent)] bg-[var(--accent-soft)] opacity-60"
          : "border-[var(--line-soft)] bg-[var(--panel-1)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-0)]"
      }`}
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
            if (window.confirm(`删除预设「${preset.name}」？`)) {
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

  return (
    <aside className="studio-surface flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-[var(--line-soft)] px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">Bubbles</p>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">对话框预设</h3>
      </div>

      <div className="flex gap-1.5 border-b border-[var(--line-soft)] px-2.5 py-2">
        <button
          type="button"
          className={actionButtonClass}
          onClick={() => imageInputRef.current?.click()}
          title="导入自定义对话框图片并框选填字区域"
        >
          导入对话框图
        </button>
        <button
          type="button"
          className={actionButtonClass}
          disabled={!selectedBubbleId}
          onClick={() => openPresetEditor({ bubbleId: selectedBubbleId })}
          title={selectedBubbleId ? "编辑选中气泡的填字区域" : "请先在画布上选中一个气泡"}
        >
          编辑填字区
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2.5 py-2.5">
        {userPresets.length > 0 && (
          <section className="space-y-1.5">
            <p className="px-0.5 text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
              自定义 {userPresets.length}
            </p>
            {userPresets.map(renderCard)}
          </section>
        )}

        <section className="space-y-1.5">
          <p className="px-0.5 text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            内置 {builtinPresets.length}
          </p>
          {builtinPresets.map(renderCard)}
        </section>
      </div>

      <div className="flex gap-1.5 border-t border-[var(--line-soft)] px-2.5 py-2">
        <button
          type="button"
          data-save-preset="1"
          className={`${actionButtonClass} studio-btn-primary`}
          onClick={() => void handleQuickSave()}
          title="把当前整套预设存进项目目录下的 presets 文件夹"
        >
          保存预设
        </button>
        <button
          type="button"
          data-open-preset-library="1"
          className={actionButtonClass}
          onClick={() => openPresetLibrary()}
          title="浏览预设库文件夹，载入或管理已保存的整套预设"
        >
          预设库
        </button>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          void handlePickImage(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

    </aside>
  );
}
