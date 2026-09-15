import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { loadImageElement } from "../lib/dnd";
import { useEditorStore } from "../lib/store";

export type FillResult = {
  dataUrl: string;
  width: number;
  height: number;
};

// 铺满方式沿用图像处理的三种标准语义
export type FillMode = "stretch" | "cover" | "contain";
export type FillAlign = "center" | "top" | "bottom" | "left" | "right";

const MODES: { value: FillMode; label: string; hint: string }[] = [
  { value: "stretch", label: "拉伸铺满", hint: "拉满整张画布，图片会被压扁或拉长，不留白" },
  { value: "cover", label: "等比填满", hint: "保持比例放大到盖住画布，超出画布的部分裁掉" },
  { value: "contain", label: "等比适应", hint: "保持比例缩到整张图都能看见，四周可能留白" }
];

const ALIGNS: { value: FillAlign; label: string }[] = [
  { value: "center", label: "居中" },
  { value: "top", label: "靠上" },
  { value: "bottom", label: "靠下" },
  { value: "left", label: "靠左" },
  { value: "right", label: "靠右" }
];

const PREVIEW_WIDTH = 300;

// 按铺满方式算出图片画到画布上的目标矩形，返回的是画布坐标系里的位置和尺寸
export function calcFillRect(
  mode: FillMode,
  align: FillAlign,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number
) {
  const iw = Math.max(1, imageWidth);
  const ih = Math.max(1, imageHeight);

  if (mode === "stretch") {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  }

  // contain 取较小的缩放比（整图放得下），cover 取较大的（盖满画布）
  const scale = mode === "cover"
    ? Math.max(canvasWidth / iw, canvasHeight / ih)
    : Math.min(canvasWidth / iw, canvasHeight / ih);

  const width = iw * scale;
  const height = ih * scale;

  let x = (canvasWidth - width) / 2;
  let y = (canvasHeight - height) / 2;
  if (align === "top") {
    y = 0;
  } else if (align === "bottom") {
    y = canvasHeight - height;
  } else if (align === "left") {
    x = 0;
  } else if (align === "right") {
    x = canvasWidth - width;
  }

  return { x, y, width, height };
}

export default function FillCanvasModal({
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
  onApply: (result: FillResult) => void;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const setNotice = useEditorStore((state) => state.setNotice);

  const [mode, setMode] = useState<FillMode>("cover");
  const [align, setAlign] = useState<FillAlign>("center");
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !source) {
      return;
    }
    let cancelled = false;
    void loadImageElement(source)
      .then((image) => {
        if (!cancelled) {
          setSourceSize({
            width: image.naturalWidth || 1,
            height: image.naturalHeight || 1
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, source]);

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
  const ratio = canvasWidth > 0 && canvasHeight > 0 ? (canvasWidth / canvasHeight).toFixed(2) : "-";
  const srcRatio = sourceSize.width > 0 && sourceSize.height > 0
    ? (sourceSize.width / sourceSize.height).toFixed(2)
    : "-";
  const distorted = mode === "stretch" && Math.abs(Number(ratio) - Number(srcRatio)) > 0.01;

  const apply = async () => {
    setBusy(true);
    try {
      const image = await loadImageElement(source);
      const target = document.createElement("canvas");
      target.width = Math.max(1, Math.round(canvasWidth));
      target.height = Math.max(1, Math.round(canvasHeight));
      const context = target.getContext("2d");
      if (!context) {
        throw new Error("canvas 2d 不可用");
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      const rect = calcFillRect(
        mode,
        align,
        target.width,
        target.height,
        image.naturalWidth || 1,
        image.naturalHeight || 1
      );
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height);

      onApply({
        dataUrl: target.toDataURL("image/png"),
        width: target.width,
        height: target.height
      });
      onClose();
    } catch {
      setNotice("生成失败，请换一张图片再试");
    } finally {
      setBusy(false);
    }
  };

  // 和去背景窗口一样必须挂到 body：挂在左栏 aside 里会被那个窄容器压扁
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onPointerDown={onClose}>
      <div
        data-fill-modal="1"
        className="studio-surface flex max-h-full w-full max-w-4xl flex-col overflow-hidden"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-5 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-secondary)]">图片处理</p>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">铺满画布</h3>
          </div>
          <button type="button" className="studio-btn h-9 px-4 text-sm" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 overflow-auto p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* 左列：预览 */}
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-[var(--text-secondary)]">
              画布预览 {Math.round(canvasWidth)} × {Math.round(canvasHeight)}
            </p>
            <div
              data-fill-preview="1"
              data-fill-mode={mode}
              className="checker-bg overflow-hidden rounded-lg border border-[var(--line-soft)]"
              style={{ width: PREVIEW_WIDTH + "px", height: previewHeight + "px" }}
            >
              <img
                src={source}
                alt="铺满预览"
                className="h-full w-full"
                style={{ objectFit: mode === "stretch" ? "fill" : mode, objectPosition: align }}
              />
            </div>
            <p className="text-sm leading-5 text-[var(--text-secondary)]">
              棋盘格是画布上没被图片盖到的部分。生成后是一张和画布等大的图片层，可以继续拖动缩放。
            </p>
          </div>

          {/* 右列：参数，按组分开 */}
          <div className="space-y-7">
            <section data-fill-section="mode" className="space-y-2">
              <p className="text-sm font-medium text-[var(--text-primary)]">铺满方式</p>
              <div className="space-y-1.5">
                {MODES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    data-fill-mode-option={item.value}
                    onClick={() => setMode(item.value)}
                    className={
                      "flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition " +
                      (mode === item.value
                        ? "border-cyan-300/80 bg-cyan-300/10"
                        : "border-[var(--line-soft)] hover:border-cyan-300/50")
                    }
                  >
                    <span className="text-sm font-medium text-[var(--text-primary)]">{item.label}</span>
                    <span className="text-xs leading-5 text-[var(--text-secondary)]">{item.hint}</span>
                  </button>
                ))}
              </div>
            </section>

            <section data-fill-section="align" className="space-y-3 border-t border-[var(--line-soft)] pt-6">
              <p className="text-sm font-medium text-[var(--text-primary)]">对齐</p>
              <div className="flex flex-wrap gap-1.5">
                {ALIGNS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    data-fill-align-option={item.value}
                    disabled={mode === "stretch"}
                    onClick={() => setAlign(item.value)}
                    className={
                      "studio-btn h-7 px-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 " +
                      (align === item.value && mode !== "stretch" ? "studio-btn-primary" : "")
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="text-xs leading-4 text-[var(--text-secondary)]">
                {mode === "stretch"
                  ? "拉伸铺满时图片已经占满画布，不需要对齐。"
                  : mode === "cover"
                    ? "决定裁切时保留图片的哪一部分。"
                    : "决定图片贴在画布的哪一侧，其余部分留白。"}
              </p>
            </section>

            <section data-fill-section="info" className="space-y-1 border-t border-[var(--line-soft)] pt-4">
              <p className="text-sm font-medium text-[var(--text-primary)]">尺寸</p>
              <p className="text-xs leading-5 text-[var(--text-secondary)]">
                原图 {sourceSize.width} × {sourceSize.height}（比例 {srcRatio}）
                <br />
                画布 {Math.round(canvasWidth)} × {Math.round(canvasHeight)}（比例 {ratio}）
              </p>
              {distorted ? (
                <p className="pt-1 text-xs leading-4 text-amber-500">
                  两者比例不同，拉伸铺满会把画面压变形。想保住形状就换成「等比填满」。
                </p>
              ) : null}
            </section>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line-soft)] px-5 py-3">
          <span className="text-sm text-[var(--text-secondary)]">
            {MODES.find((item) => item.value === mode)?.label}
          </span>
          <div className="flex gap-2">
            <button type="button" className="studio-btn h-10 px-5 text-sm" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              data-fill-apply="1"
              className="studio-btn studio-btn-primary h-10 px-6 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              disabled={busy}
              onClick={() => void apply()}
            >
              {busy ? "生成中..." : "生成并铺到画布"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
