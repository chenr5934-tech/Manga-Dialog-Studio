import { useCallback, useEffect, useState } from "react";
import { useEditorStore } from "../lib/store";

type TemplateFileEntry = {
  name: string;
  size: number;
  modified: number;
  count: number;
  detail: string;
  readable: boolean;
};

function formatSize(bytes: number) {
  if (bytes < 1024) {
    return bytes + " B";
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + " KB";
  }
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function formatTime(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    " " +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  );
}

export default function TemplateLibraryModal() {
  const open = useEditorStore((state) => state.templateLibraryOpen);
  const closeTemplateLibrary = useEditorStore((state) => state.closeTemplateLibrary);
  const buildTemplate = useEditorStore((state) => state.buildTemplate);
  const applyTemplate = useEditorStore((state) => state.applyTemplate);
  const setNotice = useEditorStore((state) => state.setNotice);
  const pageCount = useEditorStore((state) => state.project.pages.length);
  const panelCount = useEditorStore((state) =>
    state.project.pages.reduce((sum, page) => sum + page.panels.length, 0)
  );
  const bubbleCount = useEditorStore((state) =>
    state.project.pages.reduce((sum, page) => sum + page.bubbles.length, 0)
  );

  const [files, setFiles] = useState<TemplateFileEntry[]>([]);
  const [dir, setDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/templates", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "读取模板文件夹失败");
      }
      setFiles(Array.isArray(payload.files) ? payload.files : []);
      setDir(String(payload.dir ?? ""));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取模板文件夹失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTemplateLibrary();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeTemplateLibrary, open]);

  useEffect(() => {
    if (open) {
      return;
    }
    setError(null);
    setBusyName(null);
    setSaveName("");
  }, [open]);

  if (!open) {
    return null;
  }

  const useTemplate = async (name: string) => {
    setBusyName(name);
    try {
      const response = await fetch("/api/templates/file?name=" + encodeURIComponent(name), { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "读取失败");
      }
      applyTemplate(await response.text());
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "从模板新建失败");
    } finally {
      setBusyName(null);
    }
  };

  const removeFile = async (name: string) => {
    if (!window.confirm("删除模板「" + name + "」？此操作会从磁盘上移除该文件。")) {
      return;
    }
    setBusyName(name);
    try {
      const response = await fetch("/api/templates/file?name=" + encodeURIComponent(name), { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "删除失败");
      }
      setNotice("已删除 " + name);
      await refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setBusyName(null);
    }
  };

  const saveAsTemplate = async () => {
    const name = saveName.trim() || "我的漫画版式";
    setBusyName(name);
    try {
      const response = await fetch("/api/templates/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content: buildTemplate() })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "保存失败");
      }
      setNotice("已保存模板「" + name + "」（不含图片）");
      setSaveName("");
      await refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusyName(null);
    }
  };

  const revealFolder = async () => {
    try {
      await fetch("/api/templates/reveal", { method: "POST" });
    } catch {
      setNotice("无法打开文件夹");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onPointerDown={closeTemplateLibrary}>
      <div
        data-template-library="1"
        className="studio-surface flex max-h-full w-full max-w-3xl flex-col overflow-hidden"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">Layout Templates</p>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">整册版式模板</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="studio-btn h-7 px-3 text-xs" onClick={() => void revealFolder()}>
              打开文件夹
            </button>
            <button type="button" className="studio-btn h-7 px-3 text-xs" onClick={closeTemplateLibrary}>
              关闭
            </button>
          </div>
        </div>

        <div className="space-y-1 border-b border-[var(--line-soft)] px-4 py-2">
          <p className="text-[11px] text-[var(--text-primary)]">
            模板保存的是<strong>整册排版</strong>：页面尺寸、分镜位置与形状、气泡的摆位与样式。
          </p>
          <p className="text-[11px] text-[var(--text-secondary)]">
            图片不会存进模板。从模板新建后画面是空的，把新原稿导入到各分镜即可，版式不用重做。
            单个对话框的外观请用左侧的「预设库」。
          </p>
          <p className="truncate text-[11px] text-[var(--text-secondary)]" title={dir}>
            目录：{dir || "读取中..."}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-4">
          {error ? (
            <p className="rounded-lg border border-[var(--line-soft)] bg-[var(--panel-1)] px-3 py-2 text-xs text-[var(--text-primary)]">
              {error}
            </p>
          ) : null}

          {!error && files.length === 0 && !loading ? (
            <p className="rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-6 text-center text-xs text-[var(--text-secondary)]">
              还没有模板。把当前排好版的这一册存成模板，下一册就能直接套用，只换画面。
            </p>
          ) : null}

          {files.map((file) => (
            <div
              key={file.name}
              data-template-file={file.name}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--panel-1)] px-2.5 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-[var(--text-primary)]">{file.name}</span>
                <span className="block text-[10px] text-[var(--text-secondary)]">
                  {file.readable ? file.detail : "内容无法解析"} · {formatSize(file.size)} · {formatTime(file.modified)}
                </span>
              </span>
              <button
                type="button"
                data-template-use={file.name}
                className="studio-btn studio-btn-primary h-7 px-3 text-[11px] disabled:opacity-40"
                disabled={busyName === file.name}
                onClick={() => void useTemplate(file.name)}
              >
                从模板新建
              </button>
              <button
                type="button"
                className="studio-btn studio-btn-danger h-7 px-2 text-[11px] disabled:opacity-40"
                disabled={busyName === file.name}
                onClick={() => void removeFile(file.name)}
              >
                删除
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-[var(--line-soft)] px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold text-[var(--text-primary)]">把当前项目存为模板</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-[var(--text-secondary)]">
              当前 {pageCount} 页 · {panelCount} 分镜 · {bubbleCount} 气泡（图片不入库）
            </span>
            <input
              className="studio-input h-8 min-w-[180px] flex-1 px-2 text-xs"
              placeholder="模板名，例如：四格日常版式"
              value={saveName}
              data-template-save-input="1"
              onChange={(event) => setSaveName(event.target.value)}
            />
            <button
              type="button"
              data-template-save-button="1"
              className="studio-btn studio-btn-primary h-8 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              disabled={busyName !== null}
              onClick={() => void saveAsTemplate()}
            >
              保存为模板
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
