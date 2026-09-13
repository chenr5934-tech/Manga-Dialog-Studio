import { useCallback, useEffect, useState } from "react";
import { useEditorStore } from "../lib/store";

type PresetFileEntry = {
  name: string;
  size: number;
  modified: number;
  count: number;
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

export default function PresetLibraryModal() {
  const open = useEditorStore((state) => state.presetLibraryOpen);
  const closePresetLibrary = useEditorStore((state) => state.closePresetLibrary);
  const importBubblePresets = useEditorStore((state) => state.importBubblePresets);
  const exportBubblePresets = useEditorStore((state) => state.exportBubblePresets);
  const setNotice = useEditorStore((state) => state.setNotice);
  const userPresetCount = useEditorStore(
    (state) => state.bubblePresets.filter((preset) => !preset.builtin).length
  );

  const [files, setFiles] = useState<PresetFileEntry[]>([]);
  const [dir, setDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/presets", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "读取预设文件夹失败");
      }
      setFiles(Array.isArray(payload.files) ? payload.files : []);
      setDir(String(payload.dir ?? ""));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取预设文件夹失败");
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
    if (open) {
      return;
    }
    setError(null);
    setBusyName(null);
    setSaveName("");
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePresetLibrary();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePresetLibrary, open]);

  if (!open) {
    return null;
  }

  const loadFile = async (name: string) => {
    setBusyName(name);
    try {
      const response = await fetch("/api/presets/file?name=" + encodeURIComponent(name), { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "读取失败");
      }
      importBubblePresets(await response.text());
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "载入预设失败");
    } finally {
      setBusyName(null);
    }
  };

  const removeFile = async (name: string) => {
    if (!window.confirm("删除预设文件「" + name + "」？此操作会从磁盘上移除该文件。")) {
      return;
    }
    setBusyName(name);
    try {
      const response = await fetch("/api/presets/file?name=" + encodeURIComponent(name), { method: "DELETE" });
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

  const saveToLibrary = async () => {
    if (userPresetCount === 0) {
      setNotice("当前没有自定义预设可保存");
      return;
    }

    const name = saveName.trim() || "我的对话框预设";
    setBusyName(name);
    try {
      const response = await fetch("/api/presets/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content: exportBubblePresets() })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "保存失败");
      }
      setNotice("已保存 " + userPresetCount + " 个预设到文件夹");
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
      await fetch("/api/presets/reveal", { method: "POST" });
    } catch {
      setNotice("无法打开文件夹");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onPointerDown={closePresetLibrary}>
      <div
        data-preset-library="1"
        className="studio-surface flex max-h-full w-full max-w-3xl flex-col overflow-hidden"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">Preset Library</p>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">预设库文件夹</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="studio-btn h-7 px-3 text-xs" onClick={() => void revealFolder()}>
              打开文件夹
            </button>
            <button type="button" className="studio-btn h-7 px-3 text-xs" onClick={closePresetLibrary}>
              关闭
            </button>
          </div>
        </div>

        <div className="border-b border-[var(--line-soft)] px-4 py-2">
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
              文件夹里还没有预设。把当前预设保存进去，以后换电脑或做新一册时直接载入即可。
            </p>
          ) : null}

          {files.map((file) => (
            <div
              key={file.name}
              data-preset-file={file.name}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--panel-1)] px-2.5 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-[var(--text-primary)]">{file.name}</span>
                <span className="block text-[10px] text-[var(--text-secondary)]">
                  {file.readable ? file.count + " 个预设" : "内容无法解析"} · {formatSize(file.size)} ·{" "}
                  {formatTime(file.modified)}
                </span>
              </span>
              <button
                type="button"
                data-preset-load={file.name}
                className="studio-btn studio-btn-primary h-7 px-3 text-[11px] disabled:opacity-40"
                disabled={busyName === file.name}
                onClick={() => void loadFile(file.name)}
              >
                载入
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

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line-soft)] px-4 py-3">
          <span className="text-[11px] text-[var(--text-secondary)]">
            当前有 {userPresetCount} 个自定义预设
          </span>
          <input
            className="studio-input h-8 min-w-[180px] flex-1 px-2 text-xs"
            placeholder="文件名，例如：青春校园-对话框"
            value={saveName}
            data-preset-save-input="1"
            onChange={(event) => setSaveName(event.target.value)}
          />
          <button
            type="button"
            data-preset-save-button="1"
            className="studio-btn studio-btn-primary h-8 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            disabled={userPresetCount === 0 || busyName !== null}
            onClick={() => void saveToLibrary()}
          >
            保存到文件夹
          </button>
        </div>
      </div>
    </div>
  );
}
