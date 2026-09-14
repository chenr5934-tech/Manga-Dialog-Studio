import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  AgentPlan,
  applyAgentPlan,
  buildSystemPrompt,
  collectAgentContext,
  parseAgentPlan
} from "../lib/agent";
import { useEditorStore } from "../lib/store";

type ProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  defaultModel: string;
  effortParam: string | null;
};

const EFFORT_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "auto", label: "默认", hint: "不发送档位参数，用厂商自己的默认行为" },
  { value: "off", label: "关闭", hint: "最省 token，响应最快" },
  { value: "low", label: "低", hint: "少量思考" },
  { value: "high", label: "高", hint: "充分思考" },
  { value: "max", label: "最高", hint: "最大思考预算，最慢也最贵" }
];

type AgentConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  temperature: number;
  effort: string;
  hasApiKey: boolean;
  apiKeyHint: string;
  providers: ProviderPreset[];
};

type Entry = {
  id: string;
  role: "user" | "agent" | "error";
  text: string;
  applied?: string[];
  actionErrors?: string[];
};

const QUICK_TASKS = [
  "把这页切成 2×2 四格",
  "改成三行竖排分镜",
  "清空分镜后切成上一下二",
  "加一个旁白框写「三年后的夏天」"
];

const labelClass = "text-[11px] text-[var(--text-secondary)]";
const fieldClass = "studio-input h-8 w-full px-2 text-xs";

export default function AgentPanel() {
  const setNotice = useEditorStore((state) => state.setNotice);
  const setSidePanel = useEditorStore((state) => state.setSidePanel);
  const agentScope = useEditorStore((state) => state.agentScope);
  const agentScopePicking = useEditorStore((state) => state.agentScopePicking);
  const toggleAgentScopePicking = useEditorStore((state) => state.toggleAgentScopePicking);
  const setAgentScope = useEditorStore((state) => state.setAgentScope);

  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [draft, setDraft] = useState({ provider: "", baseUrl: "", model: "", apiKey: "", effort: "auto" });
  const [configOpen, setConfigOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/config", { cache: "no-store" });
      const payload = (await response.json()) as AgentConfig;
      setConfig(payload);
      setDraft({
        provider: payload.provider,
        baseUrl: payload.baseUrl,
        model: payload.model,
        apiKey: "",
        effort: payload.effort ?? "auto"
      });
    } catch {
      setNotice("读取 Agent 配置失败");
    }
  }, [setNotice]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const providers = config?.providers ?? [];
  const currentProvider = useMemo(
    () => providers.find((item) => item.id === draft.provider),
    [draft.provider, providers]
  );

  const saveConfig = async () => {
    try {
      const response = await fetch("/api/agent/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "保存失败");
      }
      setNotice("Agent 配置已保存");
      setDraft((current) => ({ ...current, apiKey: "" }));
      await loadConfig();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "保存失败");
    }
  };

  const run = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) {
      return;
    }

    setBusy(true);
    setInstruction("");
    setEntries((current) => [...current, { id: uuidv4(), role: "user", text: trimmed }]);

    try {
      const context = collectAgentContext();
      // 带上最近几轮，模型才能理解"再改一下"这类追问
      const recent = entries
        .slice(-6)
        .map((entry) =>
          entry.role === "user"
            ? { role: "user", content: entry.text }
            : { role: "assistant", content: entry.text }
        );

      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: buildSystemPrompt(context) },
            ...recent,
            { role: "user", content: trimmed }
          ]
        })
      });

      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        setEntries((current) => [
          ...current,
          { id: uuidv4(), role: "error", text: payload?.error ?? "请求失败" }
        ]);
        return;
      }

      const plan = parseAgentPlan(String(payload.content ?? ""));
      if (!plan) {
        setEntries((current) => [
          ...current,
          {
            id: uuidv4(),
            role: "error",
            text: "模型返回的内容无法解析为操作计划，可以换个说法再试",
            actionErrors: [String(payload.content ?? "").slice(0, 200)]
          }
        ]);
        return;
      }

      if (plan.actions.length === 0) {
        setEntries((current) => [
          ...current,
          { id: uuidv4(), role: "agent", text: plan.summary + "（没有需要执行的操作）" }
        ]);
        return;
      }

      const result = applyAgentPlan(plan);
      setEntries((current) => [
        ...current,
        {
          id: uuidv4(),
          role: "agent",
          text: plan.summary,
          applied: result.applied,
          actionErrors: result.errors
        }
      ]);
    } catch (caught) {
      setEntries((current) => [
        ...current,
        {
          id: uuidv4(),
          role: "error",
          text: caught instanceof Error ? caught.message : "请求失败"
        }
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="studio-surface flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-3 py-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">Agent</p>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">自动排版</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={`studio-btn h-7 px-2 text-[11px] ${configOpen ? "studio-btn-primary" : ""}`}
            data-agent-config-toggle="1"
            onClick={() => setConfigOpen((open) => !open)}
          >
            模型设置
          </button>
          <button
            type="button"
            data-agent-scope="1"
            className={`studio-btn h-7 px-2 text-[11px] ${
              agentScopePicking ? "studio-btn-primary" : ""
            }`}
            title="在画布上框出一块区域，Agent 之后只会在该区域内新增内容"
            onClick={() => toggleAgentScopePicking()}
          >
            {agentScope ? "重划范围" : "限定范围"}
          </button>
          <button
            type="button"
            className="studio-btn h-7 px-2 text-[11px]"
            onClick={() => setSidePanel("inspector")}
          >
            属性
          </button>
        </div>
      </div>

      {configOpen ? (
        <div className="space-y-2 border-b border-[var(--line-soft)] bg-[var(--panel-1)] px-3 py-3">
          <label className="block space-y-1">
            <span className={labelClass}>接口</span>
            <select
              className="studio-select h-8 w-full px-2 text-xs"
              data-agent-provider="1"
              value={draft.provider}
              onChange={(event) => {
                const next = providers.find((item) => item.id === event.target.value);
                setDraft((current) => ({
                  ...current,
                  provider: event.target.value,
                  baseUrl: next?.baseUrl ?? current.baseUrl,
                  model: next?.defaultModel ?? current.model
                }));
              }}
            >
              {providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className={labelClass}>接口地址</span>
            <input
              className={fieldClass}
              data-agent-baseurl="1"
              value={draft.baseUrl}
              placeholder={currentProvider?.baseUrl || "https://..."}
              onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
            />
          </label>

          <label className="block space-y-1">
            <span className={labelClass}>模型（可从下拉选，也可直接输入）</span>
            <input
              className={fieldClass}
              data-agent-model="1"
              list="agent-model-options"
              value={draft.model}
              placeholder={currentProvider?.defaultModel || "模型名"}
              onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
            />
            <datalist id="agent-model-options">
              {(currentProvider?.models ?? []).map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>

          <div className="space-y-1">
            <span className={labelClass}>思考档位</span>
            <div className="flex overflow-hidden rounded-lg border border-[var(--line-soft)]">
              {EFFORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  data-agent-effort={option.value}
                  title={option.hint}
                  className={`studio-btn h-7 flex-1 rounded-none border-0 px-1 text-[11px] ${
                    draft.effort === option.value ? "studio-btn-primary" : ""
                  }`}
                  onClick={() => setDraft((current) => ({ ...current, effort: option.value }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-4 text-[var(--text-secondary)]">
              {currentProvider?.effortParam
                ? `将映射为 ${currentProvider.effortParam} 参数；不同厂商支持的档位不同，不支持的会沿用默认`
                : "该接口不支持档位参数，这一项会被忽略"}
            </p>
          </div>

          <label className="block space-y-1">
            <span className={labelClass}>
              API Key{config?.hasApiKey ? `（已保存 ${config.apiKeyHint}，留空则不修改）` : ""}
            </span>
            <input
              className={fieldClass}
              data-agent-apikey="1"
              type="password"
              value={draft.apiKey}
              placeholder="sk-..."
              onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
            />
          </label>

          <p className="text-[10px] leading-4 text-[var(--text-secondary)]">
            密钥只保存在本机 config/agent.json，由本地服务转发请求，浏览器不会拿到明文，也不会随项目一起提交。
          </p>

          <button type="button" data-agent-save="1" className="studio-btn studio-btn-primary h-8 w-full text-xs" onClick={() => void saveConfig()}>
            保存设置
          </button>
        </div>
      ) : null}

      {agentScope ? (
        <div
          data-agent-scope-info="1"
          className="flex flex-wrap items-center gap-2 border-b border-amber-400/50 bg-amber-500/10 px-3 py-2 text-[11px]"
        >
          <span className="text-[var(--text-primary)]">
            作用范围：{Math.round(agentScope.width)} × {Math.round(agentScope.height)} @ (
            {Math.round(agentScope.x)}, {Math.round(agentScope.y)})
          </span>
          <span className="text-[var(--text-secondary)]">越界的操作会被跳过</span>
          <button
            type="button"
            data-agent-scope-clear="1"
            className="studio-btn ml-auto h-6 px-2 text-[10px]"
            onClick={() => setAgentScope(null)}
          >
            取消限制
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {entries.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs leading-5 text-[var(--text-secondary)]">
              用一句话描述你想要的排版，助手会转换成具体操作并执行。所有改动都进撤销历史，不满意可以
              <span className="text-[var(--text-primary)]"> Ctrl+Z </span>退回。
              <br />
              只想改局部？点上方
              <span className="text-[var(--text-primary)]">「限定范围」</span>
              在画布上框一块区域，助手就只会在那里动手。
            </p>
            <div className="space-y-1.5">
              {QUICK_TASKS.map((task) => (
                <button
                  key={task}
                  type="button"
                  className="studio-btn h-auto w-full px-2 py-1.5 text-left text-[11px] leading-4"
                  onClick={() => void run(task)}
                >
                  {task}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {entries.map((entry) => (
          <div
            key={entry.id}
            data-agent-entry={entry.role}
            className={`rounded-lg border px-2.5 py-2 text-xs ${
              entry.role === "user"
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : entry.role === "error"
                  ? "border-red-400/60 bg-red-500/10"
                  : "border-[var(--line-soft)] bg-[var(--panel-1)]"
            }`}
          >
            <p className="leading-5 text-[var(--text-primary)]">{entry.text}</p>

            {entry.applied && entry.applied.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {entry.applied.map((item, index) => (
                  <li key={index} className="text-[11px] leading-4 text-[var(--text-secondary)]">
                    · {item}
                  </li>
                ))}
              </ul>
            ) : null}

            {entry.actionErrors && entry.actionErrors.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {entry.actionErrors.map((item, index) => (
                  <li key={index} className="text-[11px] leading-4 text-red-500">
                    · {item}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--line-soft)] px-3 py-2.5">
        <textarea
          className="studio-textarea w-full px-2 py-1.5 text-xs"
          rows={2}
          data-agent-input="1"
          placeholder="例如：把这页切成一上二下三个分镜，底部加一个旁白框"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void run(instruction);
            }
          }}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-secondary)]">
            {busy ? "助手正在思考..." : "Enter 发送，Shift+Enter 换行"}
          </span>
          <button
            type="button"
            data-agent-send="1"
            className="studio-btn studio-btn-primary ml-auto h-7 px-3 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || !instruction.trim()}
            onClick={() => void run(instruction)}
          >
            发送
          </button>
        </div>
      </div>
    </aside>
  );
}
