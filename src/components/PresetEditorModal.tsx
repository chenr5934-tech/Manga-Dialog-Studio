import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { BubblePreset, BubbleTextBox } from "../types";
import { getActivePage, useEditorStore } from "../lib/store";
import { createBubblePresetFromBubble } from "../lib/project";
import { normalizePreset } from "../lib/presets";

const FONT_FAMILIES = [
  "Noto Sans SC",
  "Microsoft YaHei",
  "SimHei",
  "SimSun",
  "KaiTi",
  "Noto Serif SC",
  "Impact",
  "sans-serif"
];

const STAGE_MAX_WIDTH = 520;
const STAGE_MAX_HEIGHT = 380;
const PREVIEW_TEXT = "示例文字 ABC";

type GestureMode = "create" | "move" | "resize";

type Gesture = {
  mode: GestureMode;
  startX: number;
  startY: number;
  origin: BubbleTextBox;
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function clampRange(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function PresetEditorModal() {
  const open = useEditorStore((state) => state.presetEditorOpen);
  const seed = useEditorStore((state) => state.presetEditorSeed);
  const bubbleId = useEditorStore((state) => state.presetEditorBubbleId);
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const closePresetEditor = useEditorStore((state) => state.closePresetEditor);
  const savePreset = useEditorStore((state) => state.savePreset);
  const updateBubble = useEditorStore((state) => state.updateBubble);
  const setNotice = useEditorStore((state) => state.setNotice);

  const [draft, setDraft] = useState<BubblePreset | null>(null);
  const [previewText, setPreviewText] = useState(PREVIEW_TEXT);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);

  const targetBubbleId = bubbleId ?? (selection?.kind === "bubble" ? selection.id : undefined);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      return;
    }

    setPreviewText(PREVIEW_TEXT);

    if (seed) {
      setDraft(normalizePreset({ ...seed }));
      return;
    }

    const activePage = getActivePage(project);
    const bubble = targetBubbleId
      ? activePage.bubbles.find((entry) => entry.id === targetBubbleId)
      : undefined;

    if (bubble) {
      setDraft(createBubblePresetFromBubble(bubble, "自定义气泡"));
      return;
    }

    setDraft(
      normalizePreset({
        id: `user:${uuidv4()}`,
        name: "新预设",
        builtin: false,
        type: "rounded",
        width: 320,
        height: 200,
        textBox: { x: 0.15, y: 0.15, width: 0.7, height: 0.7 },
        background: "#ffffff",
        borderColor: "#141a22",
        borderWidth: 4,
        borderRadius: 24,
        direction: "horizontal",
        fontSize: 30,
        fontFamily: "Noto Sans SC",
        textColor: "#141a22"
      })
    );
  }, [open, project, seed, targetBubbleId]);

  const display = useMemo(() => {
    if (!draft) {
      return { width: STAGE_MAX_WIDTH, height: STAGE_MAX_HEIGHT, scale: 1 };
    }

    const scale = Math.min(STAGE_MAX_WIDTH / draft.width, STAGE_MAX_HEIGHT / draft.height, 1);
    return {
      width: Math.round(draft.width * scale),
      height: Math.round(draft.height * scale),
      scale
    };
  }, [draft]);

  const patchTextBox = useCallback((next: BubbleTextBox) => {
    setDraft((current) => (current ? { ...current, textBox: next } : current));
  }, []);

  const pointFromEvent = useCallback((event: { clientX: number; clientY: number }) => {
    const element = stageRef.current;
    if (!element) {
      return { x: 0, y: 0 };
    }
    const rect = element.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height))
    };
  }, []);

  const beginGesture = (mode: GestureMode, event: React.PointerEvent<HTMLElement>) => {
    if (!draft) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromEvent(event);
    gestureRef.current = {
      mode,
      startX: point.x,
      startY: point.y,
      origin: draft.textBox
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) {
      return;
    }

    const point = pointFromEvent(event);
    const deltaX = point.x - gesture.startX;
    const deltaY = point.y - gesture.startY;
    const origin = gesture.origin;

    if (gesture.mode === "move") {
      patchTextBox({
        x: clampRange(origin.x + deltaX, 0, Math.max(0, 1 - origin.width)),
        y: clampRange(origin.y + deltaY, 0, Math.max(0, 1 - origin.height)),
        width: origin.width,
        height: origin.height
      });
      return;
    }

    if (gesture.mode === "resize") {
      patchTextBox({
        x: origin.x,
        y: origin.y,
        width: clampRange(origin.width + deltaX, 0.05, Math.max(0.05, 1 - origin.x)),
        height: clampRange(origin.height + deltaY, 0.05, Math.max(0.05, 1 - origin.y))
      });
      return;
    }

    const x = Math.min(gesture.startX, point.x);
    const y = Math.min(gesture.startY, point.y);
    patchTextBox({
      x,
      y,
      width: clampRange(Math.abs(point.x - gesture.startX), 0.05, Math.max(0.05, 1 - x)),
      height: clampRange(Math.abs(point.y - gesture.startY), 0.05, Math.max(0.05, 1 - y))
    });
  };

  const endGesture = () => {
    gestureRef.current = null;
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePresetEditor();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePresetEditor, open]);

  if (!open || !draft) {
    return null;
  }

  const canApplyToBubble = Boolean(targetBubbleId);

  const handleApplyToBubble = () => {
    if (!targetBubbleId) {
      return;
    }

    updateBubble(targetBubbleId, {
      textBox: draft.textBox,
      image: draft.image,
      type: draft.image ? "image" : draft.type,
      fontSize: draft.fontSize,
      fontFamily: draft.fontFamily,
      textColor: draft.textColor,
      background: draft.background,
      borderColor: draft.borderColor,
      borderWidth: draft.borderWidth,
      direction: draft.direction,
      strokeText: draft.strokeText,
      strokeColor: draft.strokeColor,
      strokeTextWidth: draft.strokeTextWidth,
      opacity: previewOpacity
    });
    setNotice("已应用到当前气泡");
  };

  // 编辑完直接落盘到预设库：先入库，再把整库写成一份文件
  const handleSaveAndStore = async () => {
    const fileName = window.prompt("保存到预设库的文件名", "我的对话框预设");
    if (!fileName || !fileName.trim()) {
      return;
    }

    const nextPreset = normalizePreset({
      ...draft,
      id: draft.id.startsWith("user:") ? draft.id : `user:${uuidv4()}`,
      builtin: false,
      name: draft.name.trim() || "自定义气泡"
    });

    const existing = useEditorStore.getState().bubblePresets.filter((preset) => !preset.builtin);
    const merged = [...existing.filter((preset) => preset.id !== nextPreset.id), nextPreset];
    savePreset(nextPreset);

    try {
      const response = await fetch("/api/presets/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fileName.trim(),
          content: JSON.stringify({ version: 1, presets: merged }, null, 2)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "存入预设库失败");
      }
      setNotice(`已存入预设库：${fileName.trim()}（含 ${merged.length} 个预设）`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "存入预设库失败");
    }

    closePresetEditor();
  };

  const handleSavePreset = () => {
    const next = normalizePreset({
      ...draft,
      id: draft.id.startsWith("user:") ? draft.id : `user:${uuidv4()}`,
      builtin: false,
      name: draft.name.trim() || "自定义气泡"
    });
    savePreset(next);
    closePresetEditor();
  };

  const box = draft.textBox;
  const previewFontSize = Math.max(8, draft.fontSize * display.scale);
  const previewOpacity = typeof draft.opacity === "number" ? draft.opacity : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onPointerDown={closePresetEditor}>
      <div
        className="studio-surface flex max-h-full w-full max-w-4xl flex-col overflow-hidden"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">预设编辑o</p>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">编辑填字区域</h3>
          </div>
          <button type="button" className="studio-btn h-7 px-3 text-xs" onClick={closePresetEditor}>
            关闭
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_264px]">
          <div className="flex flex-col items-center gap-2">
            <div
              ref={stageRef}
              data-preset-stage="1"
              className={`relative touch-none select-none overflow-hidden rounded-lg border border-[var(--line-soft)] ${
                draft.image ? "checker-bg" : ""
              }`}
              style={{ width: display.width, height: display.height }}
              onPointerMove={handlePointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
              onPointerDown={(event) => beginGesture("create", event)}
            >
              {draft.image ? (
                <img
                  src={draft.image}
                  alt="对话框素材"
                  draggable={false}
                  className="pointer-events-none h-full w-full select-none object-fill"
                  style={{ opacity: previewOpacity }}
                />
              ) : (
                <div
                  className="pointer-events-none h-full w-full"
                  style={{
                    background: draft.background,
                    borderColor: draft.borderColor,
                    borderWidth: Math.max(1, draft.borderWidth * display.scale),
                    borderStyle: "solid",
                    borderRadius: draft.type === "circle" ? "50%" : draft.type === "rounded" ? 24 : 0
                  }}
                />
              )}

              <span
                className="absolute overflow-hidden text-center"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: previewFontSize,
                  fontFamily: draft.fontFamily,
                  color: draft.textColor,
                  lineHeight: 1.2,
                  cursor: "move",
                  opacity: previewOpacity
                }}
                onPointerDown={(event) => beginGesture("move", event)}
              >
                <span
                  className="pointer-events-none whitespace-pre-wrap break-all"
                  style={{
                    WebkitTextStroke: draft.strokeText
                      ? `${Math.max(1, Math.round((draft.strokeTextWidth ?? 2) * display.scale))}px ${
                          draft.strokeColor ?? "#ffffff"
                        }`
                      : undefined,
                    paintOrder: "stroke"
                  }}
                >
                  {previewText}
                </span>
              </span>

              <span
                className="pointer-events-none absolute border-2 border-dashed border-[var(--accent)]"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`
                }}
              />

              <span
                className="absolute h-3.5 w-3.5 cursor-se-resize rounded-sm border-2 border-white bg-[var(--accent)]"
                style={{
                  left: `calc(${(box.x + box.width) * 100}% - 7px)`,
                  top: `calc(${(box.y + box.height) * 100}% - 7px)`
                }}
                onPointerDown={(event) => beginGesture("resize", event)}
              />
            </div>

            <p className="text-[11px] text-[var(--text-secondary)]">
              在素材上拖拽框出填字区域，拖动虚线框可移动，拖右下角可缩放
            </p>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--text-secondary)]">预设名称</span>
              <input
                className="studio-input h-8 w-full px-2 text-xs"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--text-secondary)]">预览文字</span>
              <input
                className="studio-input h-8 w-full px-2 text-xs"
                value={previewText}
                onChange={(event) => setPreviewText(event.target.value)}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--text-secondary)]">字体</span>
              <select
                className="studio-select h-8 w-full px-2 text-xs"
                value={draft.fontFamily}
                onChange={(event) => setDraft({ ...draft, fontFamily: event.target.value })}
              >
                {FONT_FAMILIES.map((family) => (
                  <option key={family} value={family}>
                    {family}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-[var(--text-secondary)]">字号</span>
                <input
                  type="number"
                  min={8}
                  max={240}
                  className="studio-input h-8 w-full px-2 text-xs"
                  value={draft.fontSize}
                  onChange={(event) =>
                    setDraft({ ...draft, fontSize: Math.max(8, Number(event.target.value) || 8) })
                  }
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-[var(--text-secondary)]">文字颜色</span>
                <input
                  type="color"
                  className="studio-input h-8 w-full px-1"
                  value={draft.textColor}
                  onChange={(event) => setDraft({ ...draft, textColor: event.target.value })}
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--text-secondary)]">排版方向</span>
              <select
                className="studio-select h-8 w-full px-2 text-xs"
                value={draft.direction}
                onChange={(event) =>
                  setDraft({ ...draft, direction: event.target.value === "vertical" ? "vertical" : "horizontal" })
                }
              >
                <option value="horizontal">横排</option>
                <option value="vertical">竖排</option>
              </select>
            </label>

            <div className="studio-subtle space-y-2 rounded-lg p-2.5">
              <label className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-primary)]">
                <span>文字描边</span>
                <input
                  type="checkbox"
                  checked={Boolean(draft.strokeText)}
                  onChange={(event) => setDraft({ ...draft, strokeText: event.target.checked })}
                />
              </label>

              {draft.strokeText && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-[var(--text-secondary)]">描边色</span>
                    <input
                      type="color"
                      className="studio-input h-7 w-full px-1"
                      value={draft.strokeColor ?? "#ffffff"}
                      onChange={(event) => setDraft({ ...draft, strokeColor: event.target.value })}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] text-[var(--text-secondary)]">粗细</span>
                    <input
                      type="number"
                      min={0}
                      max={40}
                      className="studio-input h-7 w-full px-2 text-xs"
                      value={draft.strokeTextWidth ?? 4}
                      onChange={(event) =>
                        setDraft({ ...draft, strokeTextWidth: Math.max(0, Number(event.target.value) || 0) })
                      }
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="studio-subtle space-y-2 rounded-lg p-2.5">
              <div className="flex items-center justify-between text-[11px] text-[var(--text-primary)]">
                <span>不透明度</span>
                <span className="text-[var(--text-secondary)]">{Math.round(previewOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(previewOpacity * 100)}
                onChange={(event) => setDraft({ ...draft, opacity: Number(event.target.value) / 100 })}
                className="w-full accent-[var(--accent)]"
              />
            </div>

            <div className="studio-subtle space-y-2 rounded-lg p-2.5 text-[11px] text-[var(--text-secondary)]">
              <p>填字区域（相对比例）</p>
              <p className="font-mono text-[10px] text-[var(--text-primary)]">
                x {box.x.toFixed(3)} · y {box.y.toFixed(3)} · w {box.width.toFixed(3)} · h {box.height.toFixed(3)}
              </p>
              <button
                type="button"
                className="studio-btn h-7 w-full text-[11px]"
                onClick={() => patchTextBox({ x: 0.15, y: 0.15, width: 0.7, height: 0.7 })}
              >
                重置为居中区域
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line-soft)] px-4 py-3">
          <span className="text-[11px] text-[var(--text-secondary)]">
            {canApplyToBubble ? "可直接应用到当前选中气泡" : "保存后会出现在左侧预设列表"}
          </span>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="studio-btn h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canApplyToBubble}
              onClick={handleApplyToBubble}
            >
              应用到气泡
            </button>
            <button type="button" className="studio-btn h-8 px-4 text-xs" onClick={handleSavePreset}>
              保存为预设
            </button>
            <button
              type="button"
              data-save-to-library="1"
              className="studio-btn studio-btn-primary h-8 px-4 text-xs"
              onClick={() => void handleSaveAndStore()}
              title="保存为预设，同时写进项目目录下的 presets 文件夹"
            >
              保存并存入预设库
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
