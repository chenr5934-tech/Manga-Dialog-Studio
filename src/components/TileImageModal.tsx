import { useEffect, useState } from "react";
import { loadImageElement } from "../lib/dnd";
import { useEditorStore } from "../lib/store";

export type TileResult = {
  dataUrl: string;
  width: number;
  height: number;
};

type Crop = { x: number; y: number; w: number; h: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// 在原图里取一块与目标宽高比相同的最大居中区域，避免默认就变形
function fitCrop(srcW: number, srcH: number, ratio: number): Crop {
  let width = srcW;
  let height = srcW / ratio;
  if (height > srcH) {
    height = srcH;
    width = srcH * ratio;
  }
  return {
    x: (srcW - width) / 2 / srcW,
    y: (srcH - height) / 2 / srcH,
    w: width / srcW,
    h: height / srcH
  };
}

const PREVIEW_WIDTH = 300;

export default function TileImageModal({
  source,
  open,
  onClose,
  onApply,
  canvasWidth,
  canvasHeight
}: {
  source: string;
  open: boolean;
  onClose: () => void;
  onApply: (result: TileResult) => void;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const setNotice = useEditorStore((state) => state.setNotice);

  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(4);
  const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, w: 1, h: 1 });
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !source || canvasWidth <= 0 || canvasHeight <= 0) {
      return;
    }
    let cancelled = false;
    const ratio = canvasWidth / canvasHeight;
    void loadImageElement(source)
      .then((image) => {
        if (cancelled) {
          return;
        }
        const width = image.naturalWidth || 1;
        const height = image.naturalHeight || 1;
        setSourceSize({ width, height });
        setCrop(fitCrop(width, height, ratio));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, source, canvasWidth, canvasHeight]);

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

  const previewHeight = canvasWidth > 0 ? Math.round((PREVIEW_WIDTH * canvasHeight) / canvasWidth) : PREVIEW_WIDTH;
  const cellWidth = PREVIEW_WIDTH / cols;
  const cellHeight = previewHeight / rows;
  const offsetX = crop.w > 0 ? -(crop.x / crop.w) * cellWidth : 0;
  const offsetY = crop.h > 0 ? -(crop.y / crop.h) * cellHeight : 0;

  const setCropField = (key: keyof Crop, value: number) => {
    setCrop((prev) => {
      const next = { ...prev, [key]: clamp01(value) };
      // 起点 + 尺寸不能越界，直接夹住而不是报错
      if (key === "x") {
        next.w = Math.min(next.w, 1 - next.x);
      } else if (key === "y") {
        next.h = Math.min(next.h, 1 - next.y);
      } else if (key === "w") {
        next.x = Math.min(next.x, 1 - next.w);
      } else {
        next.y = Math.min(next.y, 1 - next.h);
      }
      next.w = Math.max(0.02, next.w);
      next.h = Math.max(0.02, next.h);
      return next;
    });
  };

  const resetCrop = () => {
    if (sourceSize.width > 0 && sourceSize.height > 0 && canvasWidth > 0 && canvasHeight > 0) {
      setCrop(fitCrop(sourceSize.width, sourceSize.height, canvasWidth / canvasHeight));
    } else {
      setCrop({ x: 0, y: 0, w: 1, h: 1 });
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const image = await loadImageElement(source);
      const naturalWidth = image.naturalWidth || 1;
      const naturalHeight = image.naturalHeight || 1;

      const target = document.createElement("canvas");
      target.width = Math.max(1, Math.round(canvasWidth));
      target.height = Math.max(1, Math.round(canvasHeight));
      const context = target.getContext("2d");
      if (!context) {
        throw new Error("canvas 2d 不可用");
      }

      const sx = crop.x * naturalWidth;
      const sy = crop.y * naturalHeight;
      const sw = Math.max(1, crop.w * naturalWidth);
      const sh = Math.max(1, crop.h * naturalHeight);

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      // 用整数边界画每个格子，避免出现 1px 的接缝
      const cellW = target.width / cols;
      const cellH = target.height / rows;
      for (let row = 0; row < rows; row += 1) {
        const y0 = Math.round(row * cellH);
        const y1 = Math.round((row + 1) * cellH);
        for (let col = 0; col < cols; col += 1) {
          const x0 = Math.round(col * cellW);
          const x1 = Math.round((col + 1) * cellW);
          context.drawImage(image, sx, sy, sw, sh, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
        }
      }

      onApply({
        dataUrl: target.toDataURL("image/png"),
        width: target.width,
        height: target.height
      });
      onClose();
    } catch {
      setNotice("平铺生成失败，请换一张图片再试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onPointerDown={onClose}>
      <div
        data-tile-modal="1"
        className="studio-surface flex max-h-full w-full max-w-4xl flex-col overflow-hidden"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">图片处理</p>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">平铺铺满画布</h3>
          </div>
          <button type="button" className="studio-btn h-7 px-3 text-xs" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_290px]">
          <div className="flex flex-col items-center gap-3">
            <p className="text-[11px] text-[var(--text-secondary)]">
              画布预览（{Math.round(canvasWidth)} × {Math.round(canvasHeight)} 像素，{cols} 列 × {rows} 行）
            </p>
            <div
              data-tile-preview="1"
              className="overflow-hidden rounded-lg border border-[var(--line-soft)]"
              style={{
                width: PREVIEW_WIDTH + "px",
                height: previewHeight + "px",
                backgroundImage: "url(" + source + ")",
                backgroundSize: cellWidth + "px " + cellHeight + "px",
                backgroundPosition: offsetX + "px " + offsetY + "px",
                backgroundRepeat: "repeat"
              }}
            />
            <div className="grid w-full grid-cols-2 items-start gap-3">
              <div className="space-y-1">
                <p className="text-center text-[11px] text-[var(--text-secondary)]">原图（框内为平铺单元）</p>
                <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-lg border border-[var(--line-soft)] bg-[var(--panel-1)] p-1">
                  <img src={source} alt="原图" className="max-h-full max-w-full object-contain" />
                  <div
                    className="pointer-events-none absolute border-2 border-cyan-300 bg-cyan-300/15"
                    style={{
                      left: crop.x * 100 + "%",
                      top: crop.y * 100 + "%",
                      width: crop.w * 100 + "%",
                      height: crop.h * 100 + "%"
                    }}
                  />
                </div>
              </div>
              <p className="text-[11px] leading-5 text-[var(--text-secondary)]">
                平铺会按「列 × 行」把选中的单元重复铺到整张画布上，生成一张铺满画布的新图片层。
                网点、网纹、渐变底纹都能这么用。生成后可以继续拖拽、缩放，也能在「已导入图片」里看到它。
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-[11px] text-[var(--text-secondary)]">横向列数 {cols}</p>
              <input
                type="range"
                min={1}
                max={24}
                step={1}
                data-tile-cols="1"
                value={cols}
                onChange={(event) => setCols(Math.max(1, Number(event.target.value)))}
                className="w-full accent-[var(--accent)]"
              />
            </div>

            <div className="space-y-1">
              <p className="text-[11px] text-[var(--text-secondary)]">纵向行数 {rows}</p>
              <input
                type="range"
                min={1}
                max={24}
                step={1}
                data-tile-rows="1"
                value={rows}
                onChange={(event) => setRows(Math.max(1, Number(event.target.value)))}
                className="w-full accent-[var(--accent)]"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                [2, 2],
                [3, 3],
                [4, 4],
                [6, 8],
                [1, 2],
                [2, 1]
              ].map(([c, r]) => (
                <button
                  key={c + "x" + r}
                  type="button"
                  className="studio-btn h-7 px-2 text-[11px]"
                  onClick={() => {
                    setCols(c);
                    setRows(r);
                  }}
                >
                  {c} × {r}
                </button>
              ))}
            </div>

            <div className="space-y-2 border-t border-[var(--line-soft)] pt-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-[var(--text-secondary)]">平铺单元的选取范围</p>
                <button type="button" className="studio-btn h-7 px-2 text-[11px]" onClick={resetCrop}>
                  重置
                </button>
              </div>
              {(
                [
                  ["x", "左边界"],
                  ["y", "上边界"],
                  ["w", "宽度"],
                  ["h", "高度"]
                ] as [keyof Crop, string][]
              ).map(([key, label]) => (
                <label key={key} className="block space-y-0.5">
                  <span className="text-[10px] text-[var(--text-secondary)]">
                    {label} {Math.round(crop[key] * 100)}%
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    data-tile-crop={key}
                    value={Math.round(crop[key] * 100)}
                    onChange={(event) => setCropField(key, Number(event.target.value) / 100)}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
              ))}
              <p className="text-[10px] leading-4 text-[var(--text-secondary)]">
                单元越小、份数越多，图案越密。宽度和高度调小就是把原图裁一小块拿去重复。
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line-soft)] px-4 py-3">
          <span className="text-[11px] text-[var(--text-secondary)]">
            将生成 {Math.round(canvasWidth)} × {Math.round(canvasHeight)} 像素的新图片层
          </span>
          <div className="flex gap-2">
            <button type="button" className="studio-btn h-8 px-3 text-xs" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              data-tile-apply="1"
              className="studio-btn studio-btn-primary h-8 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              disabled={busy || cols < 1 || rows < 1}
              onClick={() => void apply()}
            >
              {busy ? "生成中..." : "生成平铺图片"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
