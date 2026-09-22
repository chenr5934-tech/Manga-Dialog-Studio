import { useCallback, useEffect, useRef, useState } from "react";
import CanvasEditor, { CanvasEditorHandle } from "./components/CanvasEditor";
import InspectorPanel from "./components/InspectorPanel";
import AgentPanel from "./components/AgentPanel";
import LayerPanel from "./components/LayerPanel";
import LeftToolPanel from "./components/LeftToolPanel";
import ImportImagesModal from "./components/ImportImagesModal";
import PresetEditorModal from "./components/PresetEditorModal";
import PresetLibraryModal from "./components/PresetLibraryModal";
import TemplateLibraryModal from "./components/TemplateLibraryModal";
import ThumbRail from "./components/ThumbRail";
import Toolbar from "./components/Toolbar";
import { getActivePage, useEditorStore } from "./lib/store";
import {
  DEFAULT_UI_THEME,
  PRESET_WALLPAPERS,
  UiTheme,
  applyUiTheme,
  fetchUiTheme
} from "./lib/uiTheme";
import WallpaperEffect from "./components/WallpaperEffect";

export default function App() {
  const project = useEditorStore((state) => state.project);
  const activePage = useEditorStore((state) => getActivePage(state.project));
  const themeMode = useEditorStore((state) => state.themeMode);
  const notice = useEditorStore((state) => state.notice);
  const noticeHistory = useEditorStore((state) => state.noticeHistory);
  const sidePanel = useEditorStore((state) => state.sidePanel);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const deletePage = useEditorStore((state) => state.deletePage);
  const activePageId = useEditorStore((state) => state.project.activePageId);

  const canvasEditorRef = useRef<CanvasEditorHandle | null>(null);
  const noticeBarRef = useRef<HTMLDivElement | null>(null);
  const activePageNumber = project.pages.findIndex((page) => page.id === project.activePageId) + 1;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uiTheme, setUiTheme] = useState<UiTheme>(DEFAULT_UI_THEME);

  const exportPng = useCallback(async () => {
    if (!canvasEditorRef.current) {
      return;
    }
    await canvasEditorRef.current.exportPng();
  }, []);

  const exportPdf = useCallback(async () => {
    if (!canvasEditorRef.current) {
      return;
    }
    await canvasEditorRef.current.exportPdf();
  }, []);

  const exportZip = useCallback(async (pixelRatio: number) => {
    if (!canvasEditorRef.current) {
      return;
    }
    await canvasEditorRef.current.exportPngZip(pixelRatio);
  }, []);

  // 未完成作品走 store：它要把图片与编辑历史一起打包成自包含文件
  const exportProject = useCallback(async () => {
    await useEditorStore.getState().exportProjectFile();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      const editing = tag === "input" || tag === "textarea" || target?.isContentEditable;
      if (editing) {
        return;
      }

      const commandPressed = event.metaKey || event.ctrlKey;
      if (commandPressed && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) {
            redo();
          } else {
            undo();
          }
          return;
        }

        if (key === "y") {
          event.preventDefault();
          redo();
          return;
        }
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        // 焦点在胶片栏里时，Delete 删的是整页；否则删画布上选中的对象。
        // 两处都用这一颗键，靠焦点位置区分。
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.closest("[data-thumb-rail]")) {
          event.preventDefault();
          deletePage(activePageId);
          return;
        }
        deleteSelection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePageId, deletePage, deleteSelection, redo, undo]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  // 界面外观（壁纸 + 面板透明度）放在这里做单一数据源：
  // 设置面板要改它，背景动效层要读它，一处持有比两边各自 fetch 干净。
  useEffect(() => {
    let alive = true;
    void fetchUiTheme().then((theme) => {
      if (!alive) {
        return;
      }
      setUiTheme(theme);
      applyUiTheme(theme);
    });
    return () => {
      alive = false;
    };
  }, []);

  const commitUiTheme = useCallback((theme: UiTheme) => {
    setUiTheme(theme);
    applyUiTheme(theme);
  }, []);

  // 只有选中带 effect 的背景时才有这一层，其余背景连 canvas 都不存在
  const wallpaperEffect = PRESET_WALLPAPERS.find((item) => item.id === uiTheme.wallpaper)?.effect;

  useEffect(() => {
    if (!historyOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!noticeBarRef.current?.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHistoryOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [historyOpen]);

  return (
    <div className="app-shell">
      <WallpaperEffect effect={wallpaperEffect} opacity={uiTheme.wallpaperOpacity} />
      <main className="mx-auto flex h-[calc(100vh-28px)] max-w-[1920px] min-w-0 flex-col gap-3 text-[var(--text-primary)]">
        <Toolbar
          uiTheme={uiTheme}
          onUiThemeChange={commitUiTheme}
          onExportPng={exportPng}
          onExportPdf={exportPdf}
          onExportZip={exportZip} />

        {/* 四栏的固定宽度合计必须留得下画布：原来是 260+640+336+124+12*3=1396，
            而断点在 1280，于是 1280–1400 这段宽度必出横向滚动条（1280 屏最常见）。
            现在去掉画布的 640 硬下限、固定栏各收窄一档，1280 起就能装下。 */}
        <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[248px_minmax(0,1fr)_308px_116px]">
          <div className="min-h-0">
            <LeftToolPanel
              onExportPng={exportPng}
              onExportPdf={exportPdf}
              onExportZip={exportZip}
              onExportProject={exportProject}
            />
          </div>

          <div className="min-h-0">
            <CanvasEditor ref={canvasEditorRef} />
          </div>

          <div className="min-h-0">
            {sidePanel === "agent" ? (
              <AgentPanel />
            ) : sidePanel === "layers" ? (
              <LayerPanel />
            ) : (
              <InspectorPanel />
            )}
          </div>

          <div className="min-h-0">
            <ThumbRail />
          </div>
        </section>

        {/* 两侧必须是 minmax(0,1fr)：写成 1fr 时下限是 min-content，
            字号一大两侧 chip 就把中间那条通知框挤出去，整页横向溢出十几个像素 */}
        <footer className="studio-surface grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-4 py-2.5 text-xs text-[var(--text-secondary)]">
          <div className="flex min-w-0 flex-wrap items-center gap-2 justify-self-start">
            <span className="studio-chip tnum px-2.5 py-1">
              Page {activePageNumber} / {project.pages.length}
            </span>
            <span className="studio-chip tnum px-2.5 py-1">
              Canvas {activePage.canvas.width} x {activePage.canvas.height}
            </span>
          </div>

          <div className="justify-self-center" ref={noticeBarRef}>
            <div className="relative">
              {historyOpen ? (
                <div className="studio-surface absolute bottom-full left-0 right-0 z-30 mb-2 max-h-56 overflow-auto p-2">
                  <div className="mb-1 px-1 text-[12px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">消息历史</div>
                  {noticeHistory.length === 0 ? (
                    <p className="px-1 py-1 text-xs text-[var(--text-secondary)]">暂无消息</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {noticeHistory.map((entry) => (
                        <li key={entry.id} className="studio-subtle rounded-lg px-2 py-1.5 text-left">
                          <p className="text-xs text-[var(--text-primary)]">{entry.text}</p>
                          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{entry.time}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              <button
                type="button"
                className="studio-subtle flex h-[30px] w-[280px] items-center justify-between gap-2 rounded-lg px-3 text-left sm:w-[360px] lg:w-[440px]"
                onClick={() => setHistoryOpen((open) => !open)}
                title={notice ?? "暂无消息"}
              >
                <span className="truncate text-xs text-[var(--text-primary)]">{notice ?? "准备就绪"}</span>
                <span className="text-[11px] text-[var(--text-secondary)]">{historyOpen ? "收起" : "历史"}</span>
              </button>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 justify-self-end">
            <span className="studio-chip tnum px-2.5 py-1">分镜 {activePage.panels.length}</span>
            <span className="studio-chip tnum px-2.5 py-1">文字 {activePage.bubbles.length}</span>
          </div>
        </footer>
      </main>

      <PresetEditorModal />
      <PresetLibraryModal />
      <TemplateLibraryModal />
      <ImportImagesModal />
    </div>
  );
}
