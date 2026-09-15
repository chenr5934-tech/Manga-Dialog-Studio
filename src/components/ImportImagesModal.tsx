import { useEffect, useRef, useState } from "react";
import { PageImportItem } from "../types";
import { IMAGE_FILE_ACCEPT, loadImageElement, readImageFileAsDataUrl } from "../lib/dnd";
import { makeUploadedImage } from "../lib/uploads";
import { useEditorStore } from "../lib/store";

const actionButtonClass = "studio-btn h-7 px-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-40";
const cardButtonClass = "studio-btn flex h-10 w-10 shrink-0 items-center justify-center text-sm leading-none";

export default function ImportImagesModal() {
  const open = useEditorStore((state) => state.importDialogOpen);
  const closeImportDialog = useEditorStore((state) => state.closeImportDialog);
  const setNotice = useEditorStore((state) => state.setNotice);
  const addUploadedImages = useEditorStore((state) => state.addUploadedImages);

  const [items, setItems] = useState<PageImportItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setItems([]);

      setOverIndex(null);
      dragIndexRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeImportDialog();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeImportDialog, open]);

  if (!open) {
    return null;
  }

  const addFiles = async (fileList: FileList | File[] | null) => {
    if (!fileList) {
      return;
    }

    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      return;
    }

    setBusy(true);
    const loaded: PageImportItem[] = [];

    for (const file of files) {
      try {
        const dataUrl = await readImageFileAsDataUrl(file);
        const image = await loadImageElement(dataUrl);
        loaded.push({
          name: file.name.replace(/\.[^.]+$/, ""),
          dataUrl,
          width: Math.max(1, image.naturalWidth),
          height: Math.max(1, image.naturalHeight),
          mimeType: file.type
        });
      } catch {
        // 解不开的文件直接跳过，不打断整批导入
      }
    }

    setItems((current) => [...current, ...loaded]);
    setBusy(false);
  };

  const moveItem = (index: number, direction: number) => {
    setItems((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const removeItem = (index: number) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const sortByName = () => {
    setItems((current) =>
      [...current].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true }))
    );
  };

  const handleReorderDrop = (targetIndex: number) => {
    const from = dragIndexRef.current;
    setOverIndex(null);
    dragIndexRef.current = null;

    if (from === null || from === targetIndex) {
      return;
    }

    setItems((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const confirmImport = () => {
    if (items.length === 0 || busy) {
      return;
    }

    // 导入只把原稿存进 uploads/ 素材库，**不再自动生成胶片页**。
    // 想让它变成一页，去左侧「已导入图片」把它拖到胶片栏上。
    const stored = items.map((item) =>
      makeUploadedImage(item.name, item.dataUrl, item.width, item.height)
    );
    // addUploadedImages 内部会连隐藏记录一起写回库，这里不要再单独存一次，
    // 否则会拿过期的 hidden 覆盖掉
    addUploadedImages(stored);

    setNotice("已把 " + stored.length + " 张加入素材库，拖到右侧胶片栏即可生成页面");
    closeImportDialog();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onPointerDown={closeImportDialog}>
      <div
        className="studio-surface flex max-h-full w-full max-w-3xl flex-col overflow-hidden"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">导入原稿</p>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">导入漫画原稿</h3>
          </div>
          <button type="button" className="studio-btn h-7 px-3 text-xs" onClick={closeImportDialog}>
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          <div
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition ${
              dropActive ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line-strong)] bg-[var(--panel-1)]"
            }`}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("Files")) {
                return;
              }
              event.preventDefault();
              setDropActive(true);
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes("Files")) {
                return;
              }
              event.preventDefault();
              setDropActive(false);
              void addFiles(event.dataTransfer.files);
            }}
          >
            <p className="text-xs text-[var(--text-primary)]">把图片拖到这里，或</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                className="studio-btn studio-btn-primary h-8 px-4 text-xs"
                onClick={() => fileInputRef.current?.click()}
              >
                选择图片（可多选）
              </button>
              <button
                type="button"
                className={actionButtonClass}
                onClick={sortByName}
                disabled={items.length < 2}
                title="按文件名排序，page2 会排在 page10 前面"
              >
                按文件名排序
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)]">
              每张图片成为一个页面，画布尺寸与图片一致，顺序即漫画顺序
            </p>
          </div>

          {items.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                  待导入 {items.length} 张
                </span>
                <button type="button" className={actionButtonClass} onClick={() => setItems([])}>
                  清空
                </button>
              </div>

              {items.map((item, index) => (
                <div
                  key={`${item.name}-${index}-${item.dataUrl.length}`}
                  draggable
                  onDragStart={(event) => {
                    dragIndexRef.current = index;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(index));
                  }}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes("Files")) {
                      return;
                    }
                    event.preventDefault();
                    setOverIndex(index);
                  }}
                  onDrop={(event) => {
                    if (event.dataTransfer.types.includes("Files")) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    handleReorderDrop(index);
                  }}
                  onDragEnd={() => {
                    dragIndexRef.current = null;
                    setOverIndex(null);
                  }}
                  className={`flex cursor-grab items-center gap-2 rounded-lg border p-1.5 active:cursor-grabbing ${
                    overIndex === index
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--line-soft)] bg-[var(--panel-1)]"
                  }`}
                >
                  <span className="studio-chip w-7 shrink-0 text-center text-[11px] font-semibold">{index + 1}</span>
                  <img
                    src={item.dataUrl}
                    alt={item.name}
                    draggable={false}
                    className="h-12 w-12 shrink-0 rounded border border-[var(--line-soft)] object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-[var(--text-primary)]">
                      {item.name}
                    </span>
                    <span className="block text-[10px] text-[var(--text-secondary)]">
                      {item.width} × {item.height}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={cardButtonClass}
                    onClick={() => moveItem(index, -1)}
                    disabled={index === 0}
                    title="上移"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className={cardButtonClass}
                    onClick={() => moveItem(index, 1)}
                    disabled={index === items.length - 1}
                    title="下移"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className={`${cardButtonClass} studio-btn-danger`}
                    onClick={() => removeItem(index)}
                    title="移除"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line-soft)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[11px] leading-4 text-[var(--text-secondary)]">
              导入只进「已导入图片」素材库，不生成胶片页。想让它变成一页，把它拖到右侧胶片栏上。
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-secondary)]">
              {busy ? "正在读取图片..." : items.length > 0 ? `共 ${items.length} 张` : "尚未选择图片"}
            </span>
            <button
              type="button"
              data-import-confirm="1"
              className="studio-btn studio-btn-primary h-8 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              onClick={confirmImport}
              disabled={items.length === 0 || busy}
            >
              加入素材库
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          data-import-images-input="1"
          type="file"
          multiple
          accept={IMAGE_FILE_ACCEPT}
          className="hidden"
          onChange={(event) => {
            // 先固化成数组再清空：FileList 是活引用，清空 value 会让它变空
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void addFiles(files);
          }}
        />
      </div>
    </div>
  );
}
