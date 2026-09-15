import { useMemo } from "react";
import { listLayers, LayerMove } from "../lib/layers";
import { getActivePage, useEditorStore } from "../lib/store";

const MOVE_BUTTONS: { move: LayerMove; glyph: string; label: string }[] = [
  { move: "top", glyph: "⇈", label: "置于顶层" },
  { move: "up", glyph: "↑", label: "上移一层" },
  { move: "down", glyph: "↓", label: "下移一层" },
  { move: "bottom", glyph: "⇊", label: "置于底层" }
];

const KIND_STYLE: Record<string, string> = {
  panel: "bg-sky-400/15 text-sky-300 border-sky-400/30",
  overlay: "bg-amber-400/15 text-amber-300 border-amber-400/30",
  bubble: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30"
};

export default function LayerPanel() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const selectPanel = useEditorStore((state) => state.selectPanel);
  const selectBubble = useEditorStore((state) => state.selectBubble);
  const selectOverlay = useEditorStore((state) => state.selectOverlay);
  const setSidePanel = useEditorStore((state) => state.setSidePanel);
  const moveLayer = useEditorStore((state) => state.moveLayer);

  const page = getActivePage(project);
  const layers = useMemo(() => listLayers(page), [page]);

  const select = (kind: string, id: string) => {
    if (kind === "panel") {
      selectPanel(id);
    } else if (kind === "bubble") {
      selectBubble(id);
    } else {
      selectOverlay(id);
    }
  };

  return (
    <aside
      data-layer-panel="1"
      className="studio-panel flex h-full min-h-0 w-full flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">画布内容</p>
          <p className="text-[11px] text-[var(--text-secondary)]">
            最上面一行是最顶层，共 {layers.length} 项
          </p>
        </div>
        <button
          type="button"
          data-layer-back="1"
          className="studio-btn h-8 shrink-0 px-3 text-xs"
          onClick={() => setSidePanel("inspector")}
        >
          属性
        </button>
      </div>

      <div data-layer-list="1" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {layers.length === 0 ? (
          <p className="py-6 text-center text-xs leading-5 text-[var(--text-secondary)]">
            画布上还没有内容。
            <br />
            扣选分镜、放气泡或拖入图片后，它们会列在这里。
          </p>
        ) : (
          <ul className="space-y-1">
            {/* 列表自下而上渲染，和画布叠放顺序一致 */}
            {layers.map((entry, index) => {
              const selected =
                selection?.kind === entry.kind && selection.id === entry.id;
              const isTop = index === layers.length - 1;

              return (
                <li key={entry.id}>
                  <div
                    data-layer-row={entry.id}
                    data-layer-kind={entry.kind}
                    data-layer-selected={selected ? "1" : undefined}
                    className={
                      "group flex items-center gap-2 rounded-lg border px-2 py-1.5 transition " +
                      (selected
                        ? "border-cyan-300/80 bg-cyan-300/10"
                        : "border-[var(--line-soft)] hover:border-cyan-300/50")
                    }
                  >
                    <button
                      type="button"
                      data-layer-pick={entry.id}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => select(entry.kind, entry.id)}
                    >
                      <span
                        className={
                          "shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none " +
                          (KIND_STYLE[entry.kind] ?? "")
                        }
                      >
                        {entry.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
                        {entry.detail}
                      </span>
                      {isTop ? (
                        <span className="shrink-0 text-[10px] text-[var(--text-secondary)]">顶层</span>
                      ) : null}
                    </button>

                    <div className="flex shrink-0 gap-0.5">
                      {MOVE_BUTTONS.map((item) => (
                        <button
                          key={item.move}
                          type="button"
                          data-layer-move={item.move}
                          data-layer-move-id={entry.id}
                          title={item.label}
                          className="studio-btn h-7 w-7 px-0 text-xs leading-none"
                          onClick={(event) => {
                            event.stopPropagation();
                            moveLayer(entry.id, item.move);
                          }}
                        >
                          {item.glyph}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="border-t border-[var(--line-soft)] px-3 py-2 text-[10px] leading-4 text-[var(--text-secondary)]">
        被上层挡住的东西在这里点一下就选中了，不用去画布上戳。选中后按 Delete 删除。
      </p>
    </aside>
  );
}
