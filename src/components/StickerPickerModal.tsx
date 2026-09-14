import { useState } from "react";
import { useEditorStore } from "../lib/store";
import { StickerDef, listStickerGroups } from "../lib/stickers";

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

export default function StickerPickerModal() {
  const open = useEditorStore((state) => state.stickerPickerOpen);
  const closeStickerPicker = useEditorStore((state) => state.closeStickerPicker);
  const addStickerOverlay = useEditorStore((state) => state.addStickerOverlay);
  const groups = listStickerGroups();
  const [activeGroup, setActiveGroup] = useState(groups[0]?.name ?? "");
  const [addedCount, setAddedCount] = useState(0);

  if (!open) {
    return null;
  }

  const items = groups.find((group) => group.name === activeGroup)?.items ?? groups[0]?.items ?? [];

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

      <div className="studio-surface relative flex max-h-[82vh] w-[600px] max-w-full flex-col overflow-hidden rounded-2xl">
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
              className={
                "studio-btn h-7 px-2.5 text-xs " + (group.name === activeGroup ? "studio-btn-primary" : "")
              }
              onClick={() => setActiveGroup(group.name)}
            >
              {group.name}
            </button>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-4 gap-2 overflow-y-auto p-3 sm:grid-cols-6">
          {items.map((def) => (
            <button
              key={def.id}
              type="button"
              data-sticker-id={def.id}
              title={def.name}
              className="group flex aspect-square items-center justify-center rounded-xl border border-[var(--line-soft)] bg-[var(--panel-1)] transition hover:border-cyan-300/70 hover:bg-cyan-500/10"
              onClick={() => {
                addStickerOverlay(def.id);
                setAddedCount((current) => current + 1);
              }}
            >
              <StickerPreview def={def} />
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--line-soft)] px-4 py-2.5">
          <p className="text-[11px] leading-4 text-[var(--text-secondary)]">
            单击即加到画布中央，可以连续添加；选中后可在右侧属性面板换颜色、调大小与旋转。
          </p>
          <span className="shrink-0 text-[11px] text-[var(--text-secondary)]" data-sticker-count="1">
            已添加 {addedCount}
          </span>
        </div>
      </div>
    </div>
  );
}
