import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useEditorStore } from "../lib/store";
import { StickerDef, listStickerGroups, normalizeCustomStickers } from "../lib/stickers";
import { loadImageElement, readImageFileAsDataUrl } from "../lib/dnd";

type LibraryFile = { name: string; count: number; detail: string; modified: number };

// 贴纸预览：与画布共用同一份矢量路径，所见即所得
function StickerPreview({ def }: { def: StickerDef }) {
  const stroked = def.mode === "stroke";
  return (
    <svg
      viewBox={"0 0 " + def.viewBox + " " + def.viewBox}
      className="h-full w-full p-1.5"
      aria-hidden="true"
    >
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

const CUSTOM_GROUP = "自定义";
const tileClass =
  "group relative flex aspect-square items-center justify-center rounded-xl border border-[var(--line-soft)] bg-[var(--panel-1)] transition hover:border-cyan-300/70 hover:bg-cyan-500/10";
const tileButtonClass = "studio-btn h-7 px-2.5 text-xs";

export default function StickerPickerModal() {
  const open = useEditorStore((state) => state.stickerPickerOpen);
  const closeStickerPicker = useEditorStore((state) => state.closeStickerPicker);
  const addStickerOverlay = useEditorStore((state) => state.addStickerOverlay);
  const customStickers = useEditorStore((state) => state.customStickers);
  const addCustomStickers = useEditorStore((state) => state.addCustomStickers);
  const removeCustomSticker = useEditorStore((state) => state.removeCustomSticker);
  const replaceCustomStickers = useEditorStore((state) => state.replaceCustomStickers);
  const setNotice = useEditorStore((state) => state.setNotice);

  const groups = listStickerGroups();
  const [activeGroup, setActiveGroup] = useState(groups[0]?.name ?? "");
  const [addedCount, setAddedCount] = useState(0);
  const [libraryFiles, setLibraryFiles] = useState<LibraryFile[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // 关闭时把展开的贴纸库列表收起来，下次打开是干净状态
  useEffect(() => {
    if (!open) {
      setLibraryOpen(false);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const items = groups.find((group) => group.name === activeGroup)?.items ?? [];

  const handleImportFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const imported: {
      id: string;
      name: string;
      image: string;
      naturalWidth: number;
      naturalHeight: number;
    }[] = [];

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
    setActiveGroup(CUSTOM_GROUP);
    setNotice("已导入 " + imported.length + " 张贴纸");
  };

  const saveLibrary = async () => {
    if (customStickers.length === 0) {
      setNotice("还没有自定义贴纸，先导入一张再保存");
      return;
    }

    const name = window.prompt("保存到贴纸库的文件名", "我的贴纸");
    if (!name || !name.trim()) {
      return;
    }

    setBusy(true);
    try {
      const content = JSON.stringify({ name: name.trim(), stickers: customStickers }, null, 2);
      const response = await fetch("/api/stickers/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), content })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "保存失败");
      }
      setNotice("已把 " + customStickers.length + " 张贴纸存进 stickers/");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const refreshLibrary = async () => {
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

  const loadLibraryFile = async (name: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/stickers/file?name=" + encodeURIComponent(name), { cache: "no-store" });
      const payload = await response.json();
      const incoming = normalizeCustomStickers(payload?.stickers);
      if (incoming.length === 0) {
        setNotice("这个文件里没有可用的贴纸");
        return;
      }

      const existing = new Set(customStickers.map((item) => item.image));
      const fresh = incoming.filter((item) => !existing.has(item.image));
      addCustomStickers(fresh);
      setActiveGroup(CUSTOM_GROUP);
      setNotice("已载入 " + fresh.length + " 张贴纸" + (incoming.length - fresh.length > 0 ? "（跳过重复）" : ""));
    } catch {
      setNotice("载入失败");
    } finally {
      setBusy(false);
    }
  };

  const revealLibrary = async () => {
    try {
      await fetch("/api/stickers/reveal", { method: "POST" });
    } catch {
      setNotice("无法打开目录");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(2,8,14,0.55)] p-4 backdrop-blur-[1px]"
      data-sticker-picker="1"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="关闭贴纸面板"
        onClick={closeStickerPicker}
      />

      <div className="studio-surface relative flex max-h-[84vh] w-[640px] max-w-full flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">Stickers</p>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">贴纸</h3>
          </div>
          <button type="button" className="studio-btn h-7 px-3 text-xs" onClick={closeStickerPicker} data-sticker-close="1">
            关闭
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-[var(--line-soft)] px-3 py-2">
          {groups.map((group) => (
            <button
              key={group.name}
              type="button"
              data-sticker-group={group.name}
              className={tileButtonClass + (group.name === activeGroup ? " studio-btn-primary" : "")}
              onClick={() => setActiveGroup(group.name)}
            >
              {group.name}
            </button>
          ))}
          <button
            type="button"
            data-sticker-group={CUSTOM_GROUP}
            className={tileButtonClass + (activeGroup === CUSTOM_GROUP ? " studio-btn-primary" : "")}
            onClick={() => setActiveGroup(CUSTOM_GROUP)}
          >
            自定义 {customStickers.length > 0 ? "(" + customStickers.length + ")" : ""}
          </button>
        </div>

        {activeGroup === CUSTOM_GROUP ? (
          <div className="border-b border-[var(--line-soft)] px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-sticker-import="1"
                className={tileButtonClass + " studio-btn-primary"}
                onClick={() => imageInputRef.current?.click()}
                title="导入自己的图片做贴纸，PNG 透明底效果最好，可一次选多张"
              >
                导入贴纸图片
              </button>
              <button
                type="button"
                data-sticker-save-library="1"
                className={tileButtonClass}
                disabled={busy}
                onClick={() => void saveLibrary()}
                title="把当前自定义贴纸存进项目目录的 stickers/ 文件夹"
              >
                保存到贴纸库
              </button>
              <button
                type="button"
                data-sticker-load-library="1"
                className={tileButtonClass}
                disabled={busy}
                onClick={() => void refreshLibrary()}
                title="列出 stickers/ 里的贴纸文件，可载入"
              >
                从贴纸库载入
              </button>
              <button type="button" className={tileButtonClass} onClick={() => void revealLibrary()} title="在系统文件管理器里打开 stickers/">
                打开文件夹
              </button>
            </div>

            {libraryOpen ? (
              <div className="mt-2 max-h-[132px] space-y-1 overflow-y-auto rounded-xl border border-[var(--line-soft)] p-2">
                {libraryFiles.length === 0 ? (
                  <p className="px-1 py-1 text-[11px] text-[var(--text-secondary)]">贴纸库还是空的，先导入贴纸再点「保存到贴纸库」。</p>
                ) : (
                  libraryFiles.map((file) => (
                    <div key={file.name} className="flex items-center justify-between gap-2 px-1 py-0.5">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-primary)]" title={file.name}>
                        {file.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--text-secondary)]">{file.detail}</span>
                      <button
                        type="button"
                        data-sticker-library-load={file.name}
                        className="studio-btn h-6 shrink-0 px-2 text-[10px]"
                        onClick={() => void loadLibraryFile(file.name)}
                      >
                        载入
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              data-sticker-file-input="1"
              onChange={(event) => {
                // FileList 是活引用：先固化成数组再清空 input，否则清空后拿到的是空列表
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void handleImportFiles(files);
              }}
            />
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-4 gap-2 overflow-y-auto p-3 sm:grid-cols-6">
          {activeGroup === CUSTOM_GROUP
            ? customStickers.map((item) => (
                <div key={item.id} className={tileClass}>
                  <button
                    type="button"
                    data-sticker-id={item.id}
                    title={item.name}
                    className="h-full w-full p-1.5"
                    onClick={() => {
                      addStickerOverlay(item.id);
                      setAddedCount((current) => current + 1);
                    }}
                  >
                    <img src={item.image} alt={item.name} className="h-full w-full object-contain" draggable={false} />
                  </button>
                  <button
                    type="button"
                    data-sticker-remove={item.id}
                    title="删除这张贴纸"
                    className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-[var(--panel-1)] text-[11px] text-[var(--text-secondary)] shadow group-hover:flex hover:text-red-500"
                    onClick={() => removeCustomSticker(item.id)}
                  >
                    ×
                  </button>
                </div>
              ))
            : items.map((def) => (
                <button
                  key={def.id}
                  type="button"
                  data-sticker-id={def.id}
                  title={def.name}
                  className={tileClass}
                  onClick={() => {
                    addStickerOverlay(def.id);
                    setAddedCount((current) => current + 1);
                  }}
                >
                  <StickerPreview def={def} />
                </button>
              ))}

          {activeGroup === CUSTOM_GROUP && customStickers.length === 0 ? (
            <p className="col-span-full py-6 text-center text-xs leading-6 text-[var(--text-secondary)]">
              还没有自定义贴纸。
              <br />
              点上面的「导入贴纸图片」选几张图试试，透明底 PNG 效果最好。
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--line-soft)] px-4 py-2.5">
          <p className="text-[11px] leading-4 text-[var(--text-secondary)]">
            单击即加到画布中央，可以连续添加；选中后能在右侧属性面板换颜色、调大小与旋转。
          </p>
          <span className="shrink-0 text-[11px] text-[var(--text-secondary)]" data-sticker-count="1">
            已添加 {addedCount}
          </span>
        </div>
      </div>
    </div>
  );
}
