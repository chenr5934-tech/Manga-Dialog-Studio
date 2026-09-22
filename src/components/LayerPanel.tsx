import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { buildLayerRows, LayerEntry, LayerMove } from "../lib/layers";
import { getActivePage, useEditorStore } from "../lib/store";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronRight,
  IconToBottom,
  IconToTop
} from "./icons";

const MOVE_BUTTONS: { move: LayerMove; Icon: ComponentType<{ size?: number }>; label: string }[] = [
  { move: "top", Icon: IconToTop, label: "置于顶层" },
  { move: "up", Icon: IconArrowUp, label: "上移一层" },
  { move: "down", Icon: IconArrowDown, label: "下移一层" },
  { move: "bottom", Icon: IconToBottom, label: "置于底层" }
];

// 颜色交给样式表：浅色文字在亮色主题下会糊成一片（实测对比度 1.4），
// 得按主题各给一组，Tailwind 的 300 系做不到这件事。
const KIND_STYLE: Record<string, string> = {
  panel: "kind-panel",
  overlay: "kind-overlay",
  bubble: "kind-bubble"
};

export default function LayerPanel() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const selectPanel = useEditorStore((state) => state.selectPanel);
  const selectBubble = useEditorStore((state) => state.selectBubble);
  const selectOverlay = useEditorStore((state) => state.selectOverlay);
  const setSidePanel = useEditorStore((state) => state.setSidePanel);
  const moveLayer = useEditorStore((state) => state.moveLayer);
  const setLayerName = useEditorStore((state) => state.setLayerName);
  const createLayerGroup = useEditorStore((state) => state.createLayerGroup);
  const renameLayerGroup = useEditorStore((state) => state.renameLayerGroup);
  const toggleLayerGroup = useEditorStore((state) => state.toggleLayerGroup);
  const removeLayerGroup = useEditorStore((state) => state.removeLayerGroup);
  const removeFromLayerGroup = useEditorStore((state) => state.removeFromLayerGroup);
  const reorderLayer = useEditorStore((state) => state.reorderLayer);

  const page = getActivePage(project);
  const rows = useMemo(() => buildLayerRows(page), [page]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [groupMode, setGroupMode] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  // 拖拽改层序。dragId 必须用 ref：dragstart 之后 dragover/drop 是同步来的，
  // 走 state 的话这时还没提交，读到的永远是 null，拖了等于没拖。
  const dragIdRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const dropRef = useRef<{ id: string; position: "above" | "below" } | null>(null);
  const [dropMark, setDropMark] = useState<{ id: string; position: "above" | "below" } | null>(null);

  // 对象被删掉后自动从勾选里摘掉，避免残留
  const aliveIds = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.type === "item") {
        set.add(row.entry.id);
      } else {
        row.entries.forEach((entry) => set.add(entry.id));
      }
    }
    return set;
  }, [rows]);

  useEffect(() => {
    setChecked((prev) => prev.filter((id) => aliveIds.has(id)));
  }, [aliveIds]);

  const select = (kind: string, id: string) => {
    if (kind === "panel") {
      selectPanel(id);
    } else if (kind === "bubble") {
      selectBubble(id);
    } else {
      selectOverlay(id);
    }
  };

  const beginRename = (id: string, current: string) => {
    setEditingId(id);
    setDraft(current);
  };

  const commitRename = (id: string, isGroup: boolean) => {
    if (isGroup) {
      renameLayerGroup(id, draft);
    } else {
      setLayerName(id, draft);
    }
    setEditingId(null);
  };

  const toggleCheck = (id: string) => {
    setChecked((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
  };

  // 拖拽排序。列表是「顶层在上」，所以落在某行的上半 = 插到它上面（层序更靠后）。
  const dragProps = (id: string) => ({
    draggable: !groupMode,
    onDragStart: (event: React.DragEvent) => {
      if (groupMode) {
        return;
      }
      dragIdRef.current = id;
      setDragId(id);
      event.dataTransfer.effectAllowed = "move";
      // Firefox 需要写点东西才会真正开始拖
      event.dataTransfer.setData("text/plain", id);
    },
    onDragOver: (event: React.DragEvent) => {
      const dragging = dragIdRef.current;
      if (!dragging || dragging === id) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const position = event.clientY < rect.top + rect.height / 2 ? "above" : "below";
      dropRef.current = { id, position };
      setDropMark((prev) => (prev?.id === id && prev.position === position ? prev : { id, position }));
    },
    onDragLeave: () => {
      setDropMark((prev) => (prev?.id === id ? null : prev));
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      const dragging = dragIdRef.current;
      if (dragging && dragging !== id) {
        reorderLayer(dragging, id, dropRef.current?.id === id ? dropRef.current.position : "above");
      }
      dragIdRef.current = null;
      dropRef.current = null;
      setDragId(null);
      setDropMark(null);
    },
    onDragEnd: () => {
      dragIdRef.current = null;
      dropRef.current = null;
      setDragId(null);
      setDropMark(null);
    }
  });

  const dropClass = (id: string) => {
    if (dropMark?.id !== id) {
      return "";
    }
    return dropMark.position === "above"
      ? " shadow-[inset_0_3px_0_0_var(--accent)]"
      : " shadow-[inset_0_-3px_0_0_var(--accent)]";
  };

  const renderItem = (entry: LayerEntry, inGroup: boolean) => {
    const selected = selection?.kind === entry.kind && selection.id === entry.id;
    const displayName = entry.customName ?? entry.detail;
    const editing = editingId === entry.id;

    return (
      <div
        key={entry.id}
        data-layer-row={entry.id}
        data-layer-kind={entry.kind}
        data-layer-in-group={inGroup ? "1" : undefined}
        data-layer-selected={selected ? "1" : undefined}
        data-layer-dragging={dragId === entry.id ? "1" : undefined}
        {...dragProps(entry.id)}
        className={
          "group flex items-center gap-2 rounded-lg border px-2 py-1.5 transition " +
          (inGroup ? "ml-3 " : "") +
          (dragId === entry.id ? "cursor-grabbing opacity-40 " : groupMode ? "" : "cursor-grab ") +
          (selected
            ? "border-cyan-300/80 bg-cyan-300/10"
            : "border-[var(--line-soft)] hover:border-cyan-300/50") +
          dropClass(entry.id)
        }
      >
        {groupMode ? (
          <input
            type="checkbox"
            data-layer-check={entry.id}
            className="h-4 w-4 shrink-0 accent-[var(--accent)]"
            checked={checked.includes(entry.id)}
            onChange={() => toggleCheck(entry.id)}
          />
        ) : null}

        <button
          type="button"
          data-layer-pick={entry.id}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => select(entry.kind, entry.id)}
        >
          <span
            className={
              "shrink-0 rounded border px-1.5 py-0.5 text-[11px] leading-none " + (KIND_STYLE[entry.kind] ?? "")
            }
          >
            {entry.label}
          </span>

          {editing ? (
            <input
              data-layer-name-input={entry.id}
              className="studio-input min-w-0 flex-1 px-1.5 py-0.5 text-xs"
              autoFocus
              value={draft}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => commitRename(entry.id, false)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitRename(entry.id, false);
                } else if (event.key === "Escape") {
                  setEditingId(null);
                }
              }}
            />
          ) : (
            <span
              data-layer-name={entry.id}
              title={entry.customName ? "原名：" + entry.detail : "双击可以改名"}
              className={
                "min-w-0 flex-1 truncate text-xs " +
                (entry.customName ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]")
              }
              onDoubleClick={(event) => {
                event.stopPropagation();
                beginRename(entry.id, entry.customName ?? "");
              }}
            >
              {displayName}
            </span>
          )}
        </button>

        <button
          type="button"
          data-layer-rename={entry.id}
          title="改名（也可以双击名字）"
          className="studio-btn h-7 shrink-0 px-2 text-[11px] leading-none opacity-0 transition group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            beginRename(entry.id, entry.customName ?? "");
          }}
        >
          改名
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
              <item.Icon size={14} />
            </button>
          ))}
        </div>
      </div>
    );
  };

  // 这里原本写着 studio-panel —— 那个类在样式表里从来没有定义过，面板一直是裸的。
  // 以前页面底色是深蓝渐变，看不出来；换成纯色底、再加上浅色壁纸之后，
  // 文字就直接浮在壁纸上了。现在和其它面板统一用 studio-surface。
  return (
    <aside data-layer-panel="1" className="studio-surface flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">画布内容</p>
          <p className="text-[12px] text-[var(--text-secondary)]">
            最上面一行是最顶层，共 {rows.length} 组
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

      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line-soft)] px-2 py-1.5">
        <button
          type="button"
          data-layer-group-mode="1"
          className={"studio-btn h-8 px-2.5 text-xs " + (groupMode ? "studio-btn-primary" : "")}
          onClick={() => {
            setGroupMode((prev) => !prev);
            setChecked([]);
          }}
        >
          {groupMode ? "退出整理" : "整理分组"}
        </button>

        {groupMode ? (
          <>
            <button
              type="button"
              data-layer-check-all="1"
              className="studio-btn h-8 px-2.5 text-xs"
              onClick={() => setChecked((prev) => (prev.length === aliveIds.size ? [] : [...aliveIds]))}
            >
              {checked.length === aliveIds.size ? "全不选" : "全选"}
            </button>
            <button
              type="button"
              data-layer-make-group="1"
              className="studio-btn studio-btn-primary h-8 px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              disabled={checked.length < 1}
              onClick={() => {
                createLayerGroup(checked, "");
                setChecked([]);
              }}
            >
              建成一组{checked.length > 0 ? "(" + checked.length + ")" : ""}
            </button>
            <button
              type="button"
              data-layer-leave-group="1"
              className="studio-btn h-8 px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              disabled={checked.length === 0}
              onClick={() => {
                removeFromLayerGroup(checked);
                setChecked([]);
              }}
            >
              移出分组
            </button>
          </>
        ) : null}
      </div>

      <div data-layer-list="1" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs leading-5 text-[var(--text-secondary)]">
            画布上还没有内容。
            <br />
            扣选分镜、放气泡或拖入图片后，它们会列在这里。
          </p>
        ) : (
          <ul className="space-y-1">
            {rows.map((row) => {
              if (row.type === "item") {
                return <li key={row.entry.id}>{renderItem(row.entry, false)}</li>;
              }

              const editingGroup = editingId === row.group.id;
              return (
                <li key={row.group.id} className="rounded-lg border border-[var(--line-soft)] p-1">
                  <div
                    data-layer-group={row.group.id}
                    className="group flex items-center gap-2 rounded-md px-1.5 py-1"
                  >
                    <button
                      type="button"
                      data-layer-group-toggle={row.group.id}
                      title={row.group.collapsed ? "展开" : "折叠"}
                      className="studio-btn h-7 w-7 shrink-0 px-0 text-xs leading-none"
                      onClick={() => toggleLayerGroup(row.group.id)}
                    >
                      {row.group.collapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                    </button>

                    {editingGroup ? (
                      <input
                        data-layer-group-name-input={row.group.id}
                        className="studio-input min-w-0 flex-1 px-1.5 py-0.5 text-xs"
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => commitRename(row.group.id, true)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            commitRename(row.group.id, true);
                          } else if (event.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                      />
                    ) : (
                      <span
                        data-layer-group-name={row.group.id}
                        title="双击可以改分组名"
                        className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-primary)]"
                        onDoubleClick={() => beginRename(row.group.id, row.group.name)}
                      >
                        📁 {row.group.name}
                        <span className="ml-1.5 text-[11px] font-normal text-[var(--text-secondary)]">
                          {row.group.memberIds.length} 项
                        </span>
                      </span>
                    )}

                    <button
                      type="button"
                      data-layer-group-rename={row.group.id}
                      className="studio-btn h-7 shrink-0 px-2 text-[11px] leading-none opacity-0 transition group-hover:opacity-100"
                      onClick={() => beginRename(row.group.id, row.group.name)}
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      data-layer-group-remove={row.group.id}
                      title="解散分组，里面的内容都还在"
                      className="studio-btn h-7 shrink-0 px-2 text-[11px] leading-none opacity-0 transition group-hover:opacity-100"
                      onClick={() => removeLayerGroup(row.group.id)}
                    >
                      解散
                    </button>
                  </div>

                  {!row.group.collapsed ? (
                    <div className="mt-1 space-y-1">{row.entries.map((entry) => renderItem(entry, true))}</div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="border-t border-[var(--line-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">
        拖动整行可以改叠放顺序，双击名字可以改名。分组只影响这份列表的排列，不改动画布上的叠放顺序。
      </p>
    </aside>
  );
}
