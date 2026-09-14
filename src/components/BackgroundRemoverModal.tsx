import { useCallback, useEffect, useState } from "react";
import { Panel } from "../types";
import {
  detectBackgroundColor,
  RemoveBackgroundOptions,
  removeSolidBackground,
  RgbColor
} from "../lib/imageTools";
import { useEditorStore } from "../lib/store";

function toHex(color: RgbColor) {
  const part = (value: number) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0");
  return "#" + part(color.r) + part(color.g) + part(color.b);
}

function fromHex(hex: string): RgbColor {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return { r: 255, g: 255, b: 255 };
  }
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export default function BackgroundRemoverModal({
  panel,
  open,
  onClose
}: {
  panel: Panel;
  open: boolean;
  onClose: () => void;
}) {
  const updatePanel = useEditorStore((state) => state.updatePanel);
  const setNotice = useEditorStore((state) => state.setNotice);

  const source = panel.image?.original ?? "";
  const [color, setColor] = useState<RgbColor>({ r: 255, g: 255, b: 255 });
  const [tolerance, setTolerance] = useState(42);
  const [feather, setFeather] = useState(14);
  const [preview, setPreview] = useState<string | null>(null);
  const [removedRatio, setRemovedRatio] = useState(0);
  const [busy, setBusy] = useState(false);

  // 打开时自动猜一次背景色，多数纯色背景都能直接命中
  useEffect(() => {
    if (!open || !source) {
      return;
    }
    let cancelled = false;
    setPreview(null);
    void detectBackgroundColor(source)
      .then((detected) => {
        if (!cancelled) {
          setColor(detected);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, source, panel.id]);

  const recompute = useCallback(async () => {
    if (!source) {
      return;
    }
    setBusy(true);
    try {
      const options: RemoveBackgroundOptions = { color, tolerance, feather };
      const result = await removeSolidBackground(source, options);
      setPreview(result.dataUrl);
      setRemovedRatio(result.removedRatio);
    } catch {
      setNotice("处理失败，请换一张图片再试");
    } finally {
      setBusy(false);
    }
  }, [color, feather, setNotice, source, tolerance]);

  useEffect(() => {
    if (!open || !source) {
      return;
    }
    // 参数变化后稍等一下再算，避免拖动滑条时狂算
    const timer = window.setTimeout(() => {
      void recompute();
    }, 260);
    return () => window.clearTimeout(timer);
  }, [open, recompute, source]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open || !source) {
    return null;
  }

  const apply = () => {
    if (!preview) {
      return;
    }
    updatePanel(panel.id, {
      image: {
        ...panel.image,
        original: preview,
        naturalWidth: panel.image?.naturalWidth,
        naturalHeight: panel.image?.naturalHeight,
        preserveTransparency: true
      }
    });
    setNotice("已应用去背景结果");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onPointerDown={onClose}>
      <div
        data-bg-remover="1"
        className="studio-surface flex max-h-full w-full max-w-4xl flex-col overflow-hidden"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">Background</p>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">去除同色背景</h3>
          </div>
          <button type="button" className="studio-btn h-7 px-3 text-xs" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex flex-col items-center gap-3">
            <div className="grid w-full grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-center text-[11px] text-[var(--text-secondary)]">原图</p>
                <div className="checker-bg flex h-56 items-center justify-center overflow-hidden rounded-lg border border-[var(--line-soft)] p-1">
                  <img src={source} alt="原图" className="max-h-full max-w-full object-contain" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-center text-[11px] text-[var(--text-secondary)]">
                  去背景后{preview ? "（已去除 " + Math.round(removedRatio * 100) + "%）" : ""}
                </p>
                <div className="checker-bg flex h-56 items-center justify-center overflow-hidden rounded-lg border border-[var(--line-soft)] p-1">
                  {preview ? (
                    <img src={preview} alt="去背景结果" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[11px] text-[var(--text-secondary)]">{busy ? "处理中..." : "等待参数"}</span>
                  )}
                </div>
              </div>
            </div>
            <p className="text-[11px] leading-5 text-[var(--text-secondary)]">
              棋盘格表示透明区域。调整容差能把背景去干净，留着没去净的杂点就调大容差；
              羽化用来软化边缘，避免留下硬锯齿。
            </p>
          </div>

          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-[11px] text-[var(--text-secondary)]">背景色</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="studio-input h-8 w-16 px-1"
                  data-bg-color="1"
                  value={toHex(color)}
                  onChange={(event) => setColor(fromHex(event.target.value))}
                />
                <button
                  type="button"
                  className="studio-btn h-8 px-2 text-[11px]"
                  data-bg-detect="1"
                  onClick={() => {
                    void detectBackgroundColor(source).then(setColor);
                  }}
                >
                  自动取色
                </button>
              </div>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] text-[var(--text-secondary)]">容差 {tolerance}</span>
              <input
                type="range"
                min={0}
                max={180}
                step={1}
                data-bg-tolerance="1"
                value={tolerance}
                onChange={(event) => setTolerance(Number(event.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] text-[var(--text-secondary)]">边缘羽化 {feather}</span>
              <input
                type="range"
                min={0}
                max={60}
                step={1}
                data-bg-feather="1"
                value={feather}
                onChange={(event) => setFeather(Number(event.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </label>

            <p className="rounded-lg bg-[var(--panel-1)] px-2.5 py-2 text-[11px] leading-5 text-[var(--text-secondary)]">
              只去掉与背景色接近的像素，线条和主体会保留。处理结果可撤销，不满意按 Ctrl+Z 退回。
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line-soft)] px-4 py-3">
          <span className="text-[11px] text-[var(--text-secondary)]">
            {preview ? "已按当前参数生成预览" : busy ? "正在生成预览..." : "调整参数后自动生成预览"}
          </span>
          <div className="flex gap-2">
            <button type="button" className="studio-btn h-8 px-3 text-xs" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              data-bg-apply="1"
              className="studio-btn studio-btn-primary h-8 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!preview || busy}
              onClick={apply}
            >
              应用到分镜
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
