import { FormEvent, useEffect, useRef, useState } from "react";
import { getActivePage, useEditorStore } from "../lib/store";
import { loadImageElement, readImageFileAsDataUrl } from "../lib/dnd";

const inputClass = "studio-input h-9 px-3 text-sm";
const selectClass = "studio-select h-9 px-3 text-sm";
const buttonClass = "studio-btn px-3 py-1.5 text-sm";
const compactInputClass = "studio-input h-8 min-w-[180px] flex-1 px-3 text-sm font-semibold";
const compactButtonClass = "studio-btn h-8 px-2.5 text-xs";
const projectNameClass = "studio-input h-8 w-[190px] px-3 text-sm font-semibold";
const primaryButtonClass = `${buttonClass} studio-btn-primary`;
// 主操作按钮：比普通按钮更大更粗，让高频入口在第一眼里就跳出来
const heroButtonClass = "studio-btn h-8 px-3.5 text-[13px] font-semibold";
const heroPrimaryClass = `${heroButtonClass} studio-btn-primary`;
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
  const manualPanelMode = useEditorStore((state) => state.manualPanelMode);
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
  const toggleManualPanelMode = useEditorStore((state) => state.toggleManualPanelMode);
  const toggleSnapSizeTo16 = useEditorStore((state) => state.toggleSnapSizeTo16);
  const setThemeMode = useEditorStore((state) => state.setThemeMode);
  const addBubble = useEditorStore((state) => state.addBubble);
  const storyboardMode = useEditorStore((state) => state.storyboardMode);
  const setStoryboardMode = useEditorStore((state) => state.setStoryboardMode);
  const polygonTool = useEditorStore((state) => state.polygonTool);
  const togglePolygonTool = useEditorStore((state) => state.togglePolygonTool);
  const setBackdropColor = useEditorStore((state) => state.setBackdropColor);
  const openImportDialog = useEditorStore((state) => state.openImportDialog);
  const openTemplateLibrary = useEditorStore((state) => state.openTemplateLibrary);
  const openStickerPicker = useEditorStore((state) => state.openStickerPicker);
  const sidePanel = useEditorStore((state) => state.sidePanel);
  const setSidePanel = useEditorStore((state) => state.setSidePanel);
  const saveProject = useEditorStore((state) => state.saveProject);
  const saveProjectAs = useEditorStore((state) => state.saveProjectAs);
  const loadProject = useEditorStore((state) => state.loadProject);

  const [canvasWidth, setCanvasWidth] = useState(activePage.canvas.width);
  const [canvasHeight, setCanvasHeight] = useState(activePage.canvas.height);
  const [gridRows, setGridRows] = useState(2);
  const [gridCols, setGridCols] = useState(2);
  const [splitRows, setSplitRows] = useState(2);
  const [splitCols, setSplitCols] = useState(1);
  const [allRounded, setAllRounded] = useState(false);
  const [allRadius, setAllRadius] = useState(0);
  const [allBorderWidth, setAllBorderWidth] = useState(4);
  const [activeCategory, setActiveCategory] = useState<ToolCategory | null>(null);
  const [zipPixelRatio, setZipPixelRatio] = useState(2);
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

        <span className="mx-0.5 hidden h-5 w-px bg-[var(--line-soft)] sm:block" />

        <button
          type="button"
          data-hero-import="1"
          className={heroPrimaryClass}
          onClick={() => openImportDialog()}
          title="按顺序多选导入漫画原稿图片，每张图片成为一个页面"
        >
          导入图片
        </button>
        <button
          type="button"
          data-hero-sticker="1"
          className={heroButtonClass}
          onClick={() => openStickerPicker()}
          title="打开贴纸面板，单击即可把爱心、星星等贴纸加到画面"
        >
          贴纸
        </button>
        <button
          type="button"
          data-open-template-library="1"
          className={heroButtonClass}
          onClick={() => openTemplateLibrary()}
          title="整册版式模板：保存当前排版，或从模板新建后只替换画面"
        >
          模板
        </button>
        <button
          type="button"
          data-hero-export="1"
          className={`${heroButtonClass} ${activeCategory === "export" ? "studio-btn-primary" : ""}`}
          onClick={() => toggleCategory("export")}
          title="导出 PNG / PDF / 图片 ZIP"
        >
          导出
        </button>
        <button
          type="button"
          data-agent-toggle="1"
          className={`${heroButtonClass} ${sidePanel === "agent" ? "studio-btn-primary" : ""}`}
          onClick={() => setSidePanel(sidePanel === "agent" ? "inspector" : "agent")}
          title="Agent 模式：用一句话描述想要的排版，自动生成分镜与气泡"
        >
          Agent 模式
        </button>

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
        <div className="studio-subtle flex flex-wrap items-center gap-1.5 rounded-2xl px-2 py-1.5">
          {storyboardMode === "storyboard" ? (
            <>
              <button
                type="button"
                className={`studio-btn h-7 px-2.5 text-xs ${manualPanelMode ? "studio-btn-primary" : ""}`}
                onClick={() => toggleManualPanelMode()}
                title="在画布上拖拽扣出矩形分镜"
              >
                矩形扣选
              </button>
              <button
                type="button"
                className={`studio-btn h-7 px-2.5 text-xs ${polygonTool ? "studio-btn-primary" : ""}`}
                onClick={() => togglePolygonTool()}
                title="单击加点，回到起点或按 Enter 闭合"
              >
                多边形扣选
              </button>
              <label className="studio-btn flex h-7 cursor-pointer items-center gap-1.5 px-2 text-xs">
                <span>底图色</span>
                <input
                  type="color"
                  className="h-4 w-6 cursor-pointer border-0 bg-transparent p-0"
                  value={activePage.backdropColor ?? "#f4f5f7"}
                  onChange={(event) => setBackdropColor(event.target.value)}
                  title="分镜模式的底图颜色"
                />
              </label>
            </>
          ) : (
            <button type="button" className="studio-btn h-7 px-2.5 text-xs" onClick={() => addBubble("rounded")}>
              + 圆角气泡
            </button>
          )}
        </div>

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
                    className={`${selectClass} min-w-[96px]`}
                    value={activePage.canvas.preset ?? "custom"}
                    onChange={(event) => setCanvasPreset(event.target.value as "A4" | "A3" | "custom")}
                  >
                    <option value="A4">A4</option>
                    <option value="A3">A3</option>
                    <option value="custom">Custom</option>
                  </select>
                  <form className="flex items-center gap-2" onSubmit={applyCanvasSize}>
                    <input
                      className={`${inputClass} w-24 px-2`}
                      type="number"
                      value={canvasWidth}
                      onChange={(event) => setCanvasWidth(Number(event.target.value))}
                    />
                    <span className="text-[var(--text-secondary)]">x</span>
                    <input
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
                    <input type="checkbox" checked={allRounded} onChange={(event) => setAllRounded(event.target.checked)} />
                    圆角
                  </label>
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
                        borderRadius: allRounded ? allRadius : 0,
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
                <p className="text-xs leading-5 text-[var(--text-secondary)]">
                  另存为换个位置或名字保存整册；加载项目用于继续编辑已保存的 .openkoma.json 文件。
                </p>
              </section>
            ) : null}
          </aside>
        </>
      ) : null}

    </header>
  );
}
