import { FormEvent, useEffect, useRef, useState } from "react";
import { CANVAS_PRESET_LABELS, CanvasPreset } from "../types";
import { getActivePage, useEditorStore } from "../lib/store";
import { loadImageElement, readImageFileAsDataUrl } from "../lib/dnd";
import {
  DEFAULT_UI_THEME,
  PRESET_WALLPAPERS,
  UiTheme,
  applyUiTheme,
  fetchUiTheme,
  readWallpaperFile,
  saveUiTheme
} from "../lib/uiTheme";

const inputClass = "studio-input h-9 px-3 text-sm";
const selectClass = "studio-select h-9 px-3 text-sm";
const buttonClass = "studio-btn px-3 py-1.5 text-sm";
const compactInputClass = "studio-input h-8 min-w-[180px] flex-1 px-3 text-sm font-semibold";
const compactButtonClass = "studio-btn h-8 px-2.5 text-xs";
const projectNameClass = "studio-input h-8 w-[190px] px-3 text-sm font-semibold";
const primaryButtonClass = `${buttonClass} studio-btn-primary`;
const groupClass = "studio-subtle space-y-2 rounded-2xl p-3";
const groupTitleClass = "text-[11px] uppercase tracking-[0.16em] text-[var(--text-secondary)]";

type ToolCategory = "layout" | "style" | "export" | "project";

// 抽屉只放低频设置；导入图片 / 模板 / 导出 / Agent 这四件事直接摆在第一行
const drawerCategories: ToolCategory[] = ["layout", "style", "project"];

const categoryButtonLabel: Record<ToolCategory, string> = {
  layout: "布局",
  style: "批量样式",
  export: "导出",
  project: "更多"
};

const categoryTitleMap: Record<ToolCategory, string> = {
  layout: "布局与画布",
  style: "批量样式",
  export: "导出",
  project: "项目文件"
};

type ToolbarProps = {
  onExportPng: () => Promise<void>;
  onExportPdf: () => Promise<void>;
  onExportZip: (pixelRatio: number) => Promise<void>;
};

export default function Toolbar({ onExportPng, onExportPdf, onExportZip }: ToolbarProps) {
  const project = useEditorStore((state) => state.project);
  const activePage = useEditorStore((state) => getActivePage(state.project));
  const snapSizeTo16 = useEditorStore((state) => state.snapSizeTo16);
  const themeMode = useEditorStore((state) => state.themeMode);
  const busy = useEditorStore((state) => state.busy);
  const historyPastCount = useEditorStore((state) => state.historyPast.length);
  const historyFutureCount = useEditorStore((state) => state.historyFuture.length);

  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const setProjectName = useEditorStore((state) => state.setProjectName);
  const setCanvasPreset = useEditorStore((state) => state.setCanvasPreset);
  const setCanvasSize = useEditorStore((state) => state.setCanvasSize);
  const setAllPanelsStyle = useEditorStore((state) => state.setAllPanelsStyle);
  const splitGrid = useEditorStore((state) => state.splitGrid);
  const splitSelectedPanel = useEditorStore((state) => state.splitSelectedPanel);
  const addDefaultPanel = useEditorStore((state) => state.addDefaultPanel);
  const addOverlayImage = useEditorStore((state) => state.addOverlayImage);
  const toggleSnapSizeTo16 = useEditorStore((state) => state.toggleSnapSizeTo16);
  const setThemeMode = useEditorStore((state) => state.setThemeMode);
  const storyboardMode = useEditorStore((state) => state.storyboardMode);
  const setStoryboardMode = useEditorStore((state) => state.setStoryboardMode);
  const openPresetLibrary = useEditorStore((state) => state.openPresetLibrary);
  const saveProject = useEditorStore((state) => state.saveProject);
  const saveProjectAs = useEditorStore((state) => state.saveProjectAs);
  const loadProject = useEditorStore((state) => state.loadProject);

  const [canvasWidth, setCanvasWidth] = useState(activePage.canvas.width);
  const [canvasHeight, setCanvasHeight] = useState(activePage.canvas.height);
  const [gridRows, setGridRows] = useState(2);
  const [gridCols, setGridCols] = useState(2);
  const [splitRows, setSplitRows] = useState(2);
  const [splitCols, setSplitCols] = useState(1);
  const [allCornerMode, setAllCornerMode] = useState<"round" | "chamfer">("round");
  const [allRounded, setAllRounded] = useState(false);
  const [allRadius, setAllRadius] = useState(0);
  const [allBorderWidth, setAllBorderWidth] = useState(4);
  const [activeCategory, setActiveCategory] = useState<ToolCategory | null>(null);
  const [zipPixelRatio, setZipPixelRatio] = useState(2);
  const [uiTheme, setUiTheme] = useState<UiTheme>(DEFAULT_UI_THEME);
  const wallpaperInputRef = useRef<HTMLInputElement | null>(null);
  const uiThemeSaveTimer = useRef<number | null>(null);
  const overlayInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCanvasWidth(activePage.canvas.width);
    setCanvasHeight(activePage.canvas.height);
  }, [activePage.canvas.height, activePage.canvas.width, activePage.id]);

  useEffect(() => {
    const sample = activePage.panels[0];
    if (!sample) {
      return;
    }
    setAllRounded(sample.borderRadius > 0);
    setAllRadius(sample.borderRadius);
    setAllCornerMode(sample.cornerMode === "chamfer" ? "chamfer" : "round");
    // 半径跟着当前模式显示对应那个
    setAllRadius(sample.cornerMode === "chamfer" ? sample.chamferRadius ?? 0 : sample.borderRadius);
    setAllBorderWidth(sample.borderWidth);
  }, [activePage.panels]);

  useEffect(() => {
    if (!activeCategory) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveCategory(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeCategory]);

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
      if (uiThemeSaveTimer.current !== null) {
        window.clearTimeout(uiThemeSaveTimer.current);
      }
    };
  }, []);

  // 滑块拖动会高频触发，攒 320ms 再落盘，避免狂刷 POST
  const commitUiTheme = (next: UiTheme, immediate = false) => {
    setUiTheme(next);
    applyUiTheme(next);
    if (uiThemeSaveTimer.current !== null) {
      window.clearTimeout(uiThemeSaveTimer.current);
      uiThemeSaveTimer.current = null;
    }
    if (immediate) {
      void saveUiTheme(next);
      return;
    }
    uiThemeSaveTimer.current = window.setTimeout(() => {
      uiThemeSaveTimer.current = null;
      void saveUiTheme(next);
    }, 320);
  };

  const onUiThemeChange = (patch: Partial<UiTheme>) => {
    commitUiTheme({ ...uiTheme, ...patch });
  };

  const onPickWallpaper = async (file: File) => {
    try {
      const dataUrl = await readWallpaperFile(file);
      commitUiTheme({ ...uiTheme, wallpaper: dataUrl }, true);
    } catch {
      // 读图失败就保持原样，让用户再选一次
    }
  };

  const onClearWallpaper = () => {
    commitUiTheme({ ...uiTheme, wallpaper: "" }, true);
  };

  const applyCanvasSize = (event: FormEvent) => {
    event.preventDefault();
    setCanvasSize(canvasWidth, canvasHeight);
  };

  const toggleCategory = (category: ToolCategory) => {
    setActiveCategory((current) => (current === category ? null : category));
  };

  return (
    <header className="studio-surface relative z-20 p-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--line-soft)] bg-[var(--panel-1)] px-2.5 py-2">
        <span className="studio-chip px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em]">漫画对话工坊</span>

        <input
          className={projectNameClass}
          value={project.name}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder="项目名称"
          title="项目名会影响导出文件名"
        />

        <div className="flex overflow-hidden rounded-lg border border-[var(--line-soft)]">
          <button
            type="button"
            className={`studio-btn h-7 rounded-none border-0 px-3 text-xs ${
              storyboardMode === "storyboard" ? "studio-btn-primary" : ""
            }`}
            onClick={() => setStoryboardMode("storyboard")}
          >
            分镜模式
          </button>
          <button
            type="button"
            className={`studio-btn h-7 rounded-none border-0 px-3 text-xs ${
              storyboardMode === "dialogue" ? "studio-btn-primary" : ""
            }`}
            onClick={() => setStoryboardMode("dialogue")}
          >
            对话编辑
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button className={compactButtonClass} disabled={historyPastCount === 0} onClick={() => undo()}>
            撤销
          </button>
          <button className={compactButtonClass} disabled={historyFutureCount === 0} onClick={() => redo()}>
            重做
          </button>
          <div className="studio-subtle flex h-8 items-center gap-2 rounded-full px-2">
            <span className={`text-[11px] ${themeMode === "light" ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
              亮
            </span>
            <button
              type="button"
              className={`studio-switch ${themeMode === "dark" ? "is-dark" : ""}`}
              role="switch"
              aria-label="切换黑暗模式"
              aria-checked={themeMode === "dark"}
              onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
              title={themeMode === "dark" ? "切换为亮色模式" : "切换为暗色模式"}
            >
              <span className="studio-switch-thumb" />
            </button>
            <span className={`text-[11px] ${themeMode === "dark" ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
              暗
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {drawerCategories.map((category) => (
            <button
              key={category}
              data-drawer={category}
              className={`${compactButtonClass} ${activeCategory === category ? "studio-btn-primary" : ""}`}
              onClick={() => toggleCategory(category)}
              title={categoryTitleMap[category]}
            >
              {categoryButtonLabel[category]}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            className={`${compactButtonClass} studio-btn-primary`}
            data-save-project="1"
            disabled={busy.savingProject}
            onClick={() => {
              void saveProject();
            }}
            title="保存整册项目（含图片），首次会让你选择存放位置"
          >
            {busy.savingProject ? "保存中..." : "保存项目"}
          </button>
        </div>
      </div>

      {activeCategory ? (
        <>
          <button
            className="fixed inset-0 z-40 bg-[rgba(2,8,14,0.36)] backdrop-blur-[1px]"
            type="button"
            aria-label="关闭工具抽屉"
            onClick={() => setActiveCategory(null)}
          />

          <aside className="studio-surface fixed right-3 top-[84px] z-50 w-[340px] max-w-[92vw] max-h-[calc(100vh-96px)] overflow-auto p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                {categoryTitleMap[activeCategory]}工具
              </span>
              <button className={compactButtonClass} onClick={() => setActiveCategory(null)}>
                关闭
              </button>
            </div>


            {activeCategory === "layout" ? (
              <>
              <section className={groupClass}>
                <p className={groupTitleClass}>画布</p>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    data-canvas-preset="1"
                    value={activePage.canvas.preset ?? "custom"}
                    onChange={(event) => setCanvasPreset(event.target.value as CanvasPreset)}
                    >
                      {CANVAS_PRESET_LABELS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  <form className="flex items-center gap-2" onSubmit={applyCanvasSize}>
                    <input
                      data-canvas-width="1"
                      className={`${inputClass} w-24 px-2`}
                      type="number"
                      value={canvasWidth}
                      onChange={(event) => setCanvasWidth(Number(event.target.value))}
                    />
                    <span className="text-[var(--text-secondary)]">x</span>
                    <input
                      data-canvas-height="1"
                      className={`${inputClass} w-24 px-2`}
                      type="number"
                      value={canvasHeight}
                      onChange={(event) => setCanvasHeight(Number(event.target.value))}
                    />
                    <button type="submit" className={primaryButtonClass}>
                      应用画布
                    </button>
                  </form>
                </div>
              </section>

              <section className={groupClass}>
                <p className={groupTitleClass}>分镜布局</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button className={primaryButtonClass} onClick={() => addDefaultPanel()}>
                    新建分镜
                  </button>
                  <button
                    className={primaryButtonClass}
                    data-add-overlay="1"
                    onClick={() => overlayInputRef.current?.click()}
                    title="导入一张图片作为独立图层，浮在分镜上方做前景元素"
                  >
                    添加图片层
                  </button>
                  <button
                    className={primaryButtonClass}
                    data-add-ellipse-panel="1"
                    onClick={() => {
                      const page = getActivePage(useEditorStore.getState().project);
                      const width = page.canvas.width * 0.45;
                      const height = page.canvas.height * 0.28;
                      useEditorStore.getState().createEllipsePanelFromRect(
                        (page.canvas.width - width) / 2,
                        (page.canvas.height - height) / 2,
                        width,
                        height
                      );
                    }}
                    title="创建一个椭圆（圆形）分镜，用于圆形取景"
                  >
                    椭圆分镜
                  </button>
                  <span className="text-xs text-[var(--text-secondary)]">
                    新建分镜默认为矩形，椭圆分镜用于圆形取景，图片层浮在分镜之上
                  </span>

                  <input
                    ref={overlayInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) {
                        return;
                      }
                      void (async () => {
                        try {
                          const dataUrl = await readImageFileAsDataUrl(file);
                          const image = await loadImageElement(dataUrl);
                          addOverlayImage({
                            image: dataUrl,
                            naturalWidth: image.naturalWidth || 1,
                            naturalHeight: image.naturalHeight || 1
                          });
                        } catch {
                          useEditorStore.getState().setNotice("图片层导入失败");
                        }
                      })();
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)]">网格切割</span>
                  <input
                    className={`${inputClass} w-16 px-2`}
                    type="number"
                    min={1}
                    value={gridRows}
                    onChange={(event) => setGridRows(Number(event.target.value))}
                  />
                  <span className="text-[var(--text-secondary)]">x</span>
                  <input
                    className={`${inputClass} w-16 px-2`}
                    type="number"
                    min={1}
                    value={gridCols}
                    onChange={(event) => setGridCols(Number(event.target.value))}
                  />
                  <button className={buttonClass} onClick={() => splitGrid(gridRows, gridCols)}>
                    切割画布
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className={`${buttonClass} ${snapSizeTo16 ? "border-emerald-300/70 bg-emerald-500/25" : ""}`}
                    onClick={() => toggleSnapSizeTo16()}
                  >
                    16 倍数尺寸
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)]">选中分镜二次切割</span>
                  <input
                    className={`${inputClass} w-16 px-2`}
                    type="number"
                    min={1}
                    value={splitRows}
                    onChange={(event) => setSplitRows(Number(event.target.value))}
                  />
                  <span className="text-[var(--text-secondary)]">x</span>
                  <input
                    className={`${inputClass} w-16 px-2`}
                    type="number"
                    min={1}
                    value={splitCols}
                    onChange={(event) => setSplitCols(Number(event.target.value))}
                  />
                  <button className={buttonClass} onClick={() => splitSelectedPanel(splitRows, splitCols)}>
                    应用
                  </button>
                </div>
              </section>
              </>
            ) : null}

            {activeCategory === "style" ? (
              <section className={groupClass}>
                <p className={groupTitleClass}>批量样式</p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <input
                      type="checkbox"
                      data-all-radius-toggle="1"
                      checked={allRounded}
                      onChange={(event) => setAllRounded(event.target.checked)}
                    />
                    切角
                  </label>
                  <div className="flex overflow-hidden rounded-lg border border-[var(--line-soft)]">
                    <button
                      type="button"
                      data-all-corner-mode="round"
                      className={"studio-btn h-9 rounded-none border-0 px-3 text-xs" + (allCornerMode === "round" ? " studio-btn-primary" : "")}
                      onClick={() => setAllCornerMode("round")}
                      title="圆角：四个角用圆弧过渡"
                    >
                      圆角
                    </button>
                    <button
                      type="button"
                      data-all-corner-mode="chamfer"
                      className={"studio-btn h-9 rounded-none border-0 px-3 text-xs" + (allCornerMode === "chamfer" ? " studio-btn-primary" : "")}
                      onClick={() => setAllCornerMode("chamfer")}
                      title="倒角：用一条直线把角切掉"
                    >
                      倒角
                    </button>
                  </div>
                  <input
                    className={`${inputClass} w-20 px-2`}
                    type="number"
                    min={0}
                    value={allRadius}
                    disabled={!allRounded}
                    onChange={(event) => setAllRadius(Math.max(0, Number(event.target.value)))}
                  />
                  <span className="text-xs text-[var(--text-secondary)]">边框</span>
                  <input
                    className={`${inputClass} w-20 px-2`}
                    type="number"
                    min={0}
                    value={allBorderWidth}
                    onChange={(event) => setAllBorderWidth(Math.max(0, Number(event.target.value)))}
                  />
                  <button
                    className={primaryButtonClass}
                    onClick={() =>
                      setAllPanelsStyle({
                        // 两种半径各存各的，按当前模式写对应的那个
                        borderRadius: allCornerMode === "round" && allRounded ? allRadius : 0,
                        chamferRadius: allCornerMode === "chamfer" && allRounded ? allRadius : 0,
                        cornerMode: allCornerMode,
                        borderWidth: allBorderWidth
                      })
                    }
                  >
                    应用到全部分镜
                  </button>
                </div>
              </section>
            ) : null}


            {activeCategory === "export" ? (
              <section className={groupClass}>
                <p className={groupTitleClass}>导出</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button className={primaryButtonClass} onClick={() => void onExportPng()}>
                    导出 PNG（当前页）
                  </button>
                  <button className={primaryButtonClass} onClick={() => void onExportPdf()}>
                    导出 PDF（全部页）
                  </button>
                  <button
                    className={primaryButtonClass}
                    data-export-zip="1"
                    onClick={() => void onExportZip(zipPixelRatio)}
                  >
                    导出图片 ZIP（全部页）
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <span>图片倍率</span>
                  <div className="flex overflow-hidden rounded-lg border border-[var(--line-soft)]">
                    {[1, 2].map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        className={`studio-btn h-7 rounded-none border-0 px-3 text-xs ${
                          zipPixelRatio === ratio ? "studio-btn-primary" : ""
                        }`}
                        onClick={() => setZipPixelRatio(ratio)}
                      >
                        {ratio}x
                      </button>
                    ))}
                  </div>
                  <span>每页一张 PNG，按 001、002 序号命名，解压顺序即漫画顺序</span>
                </div>
              </section>
            ) : null}

            {activeCategory === "project" ? (
              <div className="space-y-2">
                <section className={groupClass}>
                  <p className={groupTitleClass}>项目文件</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className={buttonClass}
                      data-save-as="1"
                      disabled={busy.savingProject}
                      onClick={() => {
                        void saveProjectAs();
                      }}
                    >
                      {busy.savingProject ? "处理中..." : "另存为"}
                    </button>
                    <button
                      className={buttonClass}
                      data-load-project="1"
                      disabled={busy.loadingProject}
                      onClick={() => {
                        void loadProject();
                      }}
                    >
                      {busy.loadingProject ? "加载中..." : "加载项目"}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className={buttonClass}
                      data-open-preset-library="1"
                      onClick={() => openPresetLibrary()}
                      title="浏览项目目录 presets/ 里已保存的整套对话框预设，可载入或删除"
                    >
                      预设库
                    </button>
                  </div>
                  <p className="text-xs leading-5 text-[var(--text-secondary)]">
                    另存为换个位置或名字保存整册；加载项目用于继续编辑已保存的 .openkoma.json 文件。
                  </p>
                </section>

                <section className={groupClass} data-wallpaper-section="1">
                  <p className={groupTitleClass}>界面背景</p>

                  <input
                    ref={wallpaperInputRef}
                    data-wallpaper-input="1"
                    className="hidden"
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) {
                        void onPickWallpaper(file);
                      }
                    }}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={primaryButtonClass}
                      data-wallpaper-pick="1"
                      onClick={() => wallpaperInputRef.current?.click()}
                    >
                      选一张壁纸
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      data-wallpaper-clear="1"
                      disabled={!uiTheme.wallpaper}
                      onClick={() => onClearWallpaper()}
                    >
                      恢复默认背景
                    </button>
                  </div>

                  <div className="space-y-1">
                    <span className="block text-[11px] text-[var(--text-secondary)]">
                      或者直接用内置的（不用自己找图）
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {PRESET_WALLPAPERS.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          data-wallpaper-preset={item.id}
                          title={item.label}
                          aria-label={item.label}
                          onClick={() => commitUiTheme({ ...uiTheme, wallpaper: item.id }, true)}
                          style={{ backgroundImage: item.css }}
                          className={
                            "h-8 w-12 rounded-lg border transition " +
                            (uiTheme.wallpaper === item.id
                              ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                              : "border-[var(--line-soft)] hover:border-[var(--line-strong)]")
                          }
                        />
                      ))}
                    </div>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      壁纸不透明度 {uiTheme.wallpaperOpacity}%
                    </span>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={1}
                      data-wallpaper-opacity="1"
                      value={uiTheme.wallpaperOpacity}
                      onChange={(event) => onUiThemeChange({ wallpaperOpacity: Number(event.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      壁纸模糊 {uiTheme.wallpaperBlur}px
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={40}
                      step={1}
                      data-wallpaper-blur="1"
                      value={uiTheme.wallpaperBlur}
                      onChange={(event) => onUiThemeChange({ wallpaperBlur: Number(event.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      压暗 {uiTheme.wallpaperDim}%（调大，面板上的字更清楚）
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={90}
                      step={1}
                      data-wallpaper-dim="1"
                      value={uiTheme.wallpaperDim}
                      onChange={(event) => onUiThemeChange({ wallpaperDim: Number(event.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      面板不透明度 {uiTheme.panelOpacity}%（调小，壁纸才透得出来）
                    </span>
                    <input
                      type="range"
                      min={60}
                      max={100}
                      step={1}
                      data-panel-opacity="1"
                      value={uiTheme.panelOpacity}
                      onChange={(event) => onUiThemeChange({ panelOpacity: Number(event.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                  </label>

                  <p className="text-xs leading-5 text-[var(--text-secondary)]">
                    壁纸只存在你自己电脑上的 config/ui.json，不进版本库、不随项目走。想让壁纸更抢眼就把「面板不透明度」调小；
                    觉得字看不清就把「压暗」调大。
                  </p>
                </section>
              </div>
            ) : null}
          </aside>
        </>
      ) : null}

    </header>
  );
}
