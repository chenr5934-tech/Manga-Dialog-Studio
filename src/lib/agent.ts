import { useEditorStore } from "./store";

// Agent 能执行的操作。范围刻意收窄：只暴露可撤销、不破坏文件的操作。
export type AgentAction =
  | { type: "setCanvasSize"; width: number; height: number }
  | { type: "splitGrid"; rows: number; cols: number }
  | { type: "clearPanels" }
  | { type: "clearBubbles" }
  | { type: "addPanel"; x: number; y: number; width: number; height: number }
  | { type: "setBackdropColor"; color: string }
  | { type: "setPanelStyle"; borderRadius?: number; borderWidth?: number; borderColor?: string; gap?: number }
  | {
      type: "addBubble";
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      text?: string;
      presetName?: string;
    }
  | { type: "addPage" };

export type AgentPlan = {
  summary: string;
  actions: AgentAction[];
};

export type AgentContext = {
  canvasWidth: number;
  canvasHeight: number;
  pageCount: number;
  activePageIndex: number;
  panelCount: number;
  bubbleCount: number;
  backdropColor: string;
  presetNames: string[];
};

export function collectAgentContext(): AgentContext {
  const state = useEditorStore.getState();
  const project = state.project;
  const activeIndex = Math.max(
    0,
    project.pages.findIndex((page) => page.id === project.activePageId)
  );
  const activePage = project.pages[activeIndex];

  return {
    canvasWidth: activePage?.canvas.width ?? 2480,
    canvasHeight: activePage?.canvas.height ?? 3508,
    pageCount: project.pages.length,
    activePageIndex: activeIndex,
    panelCount: activePage?.panels.length ?? 0,
    bubbleCount: activePage?.bubbles.length ?? 0,
    backdropColor: activePage?.backdropColor ?? "#f4f5f7",
    presetNames: state.bubblePresets.map((preset) => preset.name)
  };
}

// 提示词是这套机制可靠性的关键：把可用操作、坐标约束、输出格式都写死
export function buildSystemPrompt(context: AgentContext): string {
  return [
    "你是漫画分镜排版助手，负责把用户的中文指令转换成一组可执行操作。",
    "",
    "只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码围栏。格式：",
    '{"summary": "一句话说明你要做什么", "actions": [ {"type": "...", ...} ]}',
    "",
    "可用操作：",
    '- {"type":"setCanvasSize","width":数字,"height":数字}  设定当前页画布尺寸',
    '- {"type":"splitGrid","rows":数字,"cols":数字}  把整页均分为若干分镜（会替换现有分镜）',
    '- {"type":"clearPanels"}  清空当前页所有分镜',
    '- {"type":"clearBubbles"}  清空当前页所有文字',
    '- {"type":"addPanel","x":数字,"y":数字,"width":数字,"height":数字}  指定位置加一个分镜',
    '- {"type":"setPanelStyle","borderRadius":数字,"borderWidth":数字,"borderColor":"#RRGGBB","gap":数字}  批量设置所有分镜样式',
    '- {"type":"setBackdropColor","color":"#RRGGBB"}  设置页面底色',
    '- {"type":"addBubble","x":数字,"y":数字,"width":数字,"height":数字,"text":"文字","presetName":"预设名"}  加一个气泡，x/y 是气泡中心点；presetName 可省略',
    '- {"type":"addPage"}  在末尾新增一页',
    "",
    "约束：",
    "1. 坐标必须落在画布范围内，x/y 为左上角，除非该操作特别说明为中心点。",
    "2. 一页内分镜数量通常不超过 9 个，气泡不超过 12 个。",
    "3. splitGrid 会覆盖当前页已有的分镜，若用户想追加请用 addPanel。",
    "4. 用户没有明确说颜色就不要改颜色。",
    "5. actions 数组可以为空，但必须存在。",
    "6. 只使用上面列出的操作类型，不要发明新类型。",
    "",
    "当前画布状态（仅供参考）：",
    "- 画布尺寸：" + context.canvasWidth + " x " + context.canvasHeight + " 像素",
    "- 当前是第 " + (context.activePageIndex + 1) + " 页，共 " + context.pageCount + " 页",
    "- 当前页已有分镜 " + context.panelCount + " 个、气泡 " + context.bubbleCount + " 个",
    "- 页面底色：" + context.backdropColor,
    "- 可用的气泡预设名：" + (context.presetNames.join("、") || "（无）")
  ].join("\n");
}

// 模型偶尔会裹上代码围栏或加解释，这里逐级兜底提取 JSON
export function parseAgentPlan(content: string): AgentPlan | null {
  const raw = String(content ?? "").trim();
  if (!raw) {
    return null;
  }

  const candidates: string[] = [raw];

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<AgentPlan>;
      if (!parsed || !Array.isArray(parsed.actions)) {
        continue;
      }
      return {
        summary: typeof parsed.summary === "string" ? parsed.summary : "已生成排版方案",
        actions: parsed.actions as AgentAction[]
      };
    } catch {
      continue;
    }
  }

  return null;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function safeNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export type ApplyResult = {
  applied: string[];
  errors: string[];
};

// 执行计划。每个操作都走 store 里已有的 action，因此天然进入撤销历史。
export function applyAgentPlan(plan: AgentPlan): ApplyResult {
  const store = useEditorStore.getState();
  const applied: string[] = [];
  const errors: string[] = [];

  for (const action of plan.actions) {
    try {
      switch (action?.type) {
        case "setCanvasSize": {
          const width = Math.max(240, Math.round(safeNumber(action.width, 2480)));
          const height = Math.max(240, Math.round(safeNumber(action.height, 3508)));
          store.setCanvasSize(width, height);
          applied.push(`画布尺寸设为 ${width} × ${height}`);
          break;
        }

        case "splitGrid": {
          const rows = Math.min(9, Math.max(1, Math.round(safeNumber(action.rows, 2))));
          const cols = Math.min(9, Math.max(1, Math.round(safeNumber(action.cols, 2))));
          store.splitGrid(rows, cols);
          applied.push(`切分为 ${rows} 行 × ${cols} 列`);
          break;
        }

        case "clearPanels": {
          store.clearPanels();
          applied.push("清空分镜");
          break;
        }

        case "clearBubbles": {
          store.clearBubbles();
          applied.push("清空文字");
          break;
        }

        case "addPanel": {
          const x = safeNumber(action.x, 0);
          const y = safeNumber(action.y, 0);
          const width = Math.max(24, safeNumber(action.width, 400));
          const height = Math.max(24, safeNumber(action.height, 400));
          store.createPanelFromRect(x, y, width, height);
          applied.push(`新增分镜 (${Math.round(x)}, ${Math.round(y)})`);
          break;
        }

        case "setPanelStyle": {
          const style: { borderRadius?: number; borderWidth?: number } = {};
          if (Number.isFinite(Number(action.borderRadius))) {
            style.borderRadius = Math.max(0, Number(action.borderRadius));
          }
          if (Number.isFinite(Number(action.borderWidth))) {
            style.borderWidth = Math.max(0, Number(action.borderWidth));
          }
          store.setAllPanelsStyle(style);
          applied.push("更新分镜样式");
          break;
        }

        case "setBackdropColor": {
          if (!HEX_COLOR.test(String(action.color ?? ""))) {
            errors.push("底色格式不对，应为 #RRGGBB");
            break;
          }
          store.setBackdropColor(String(action.color));
          applied.push(`底色设为 ${action.color}`);
          break;
        }

        case "addBubble": {
          const page = useEditorStore.getState();
          const project = page.project;
          const activePage = project.pages.find((entry) => entry.id === project.activePageId);
          const canvas = activePage?.canvas ?? { width: 2480, height: 3508 };
          const centerX = safeNumber(action.x, canvas.width / 2);
          const centerY = safeNumber(action.y, canvas.height / 2);

          const matched = action.presetName
            ? page.bubblePresets.find((preset) => preset.name === action.presetName)
            : undefined;

          if (matched) {
            page.addBubbleFromPreset(matched.id, { x: centerX, y: centerY });
          } else {
            const before = useEditorStore.getState();
            before.addBubble("rounded");
            const after = useEditorStore.getState();
            const activeNow = after.project.pages.find((entry) => entry.id === after.project.activePageId);
            const created = activeNow?.bubbles[activeNow.bubbles.length - 1];
            if (created) {
              after.updateBubble(created.id, {
                x: centerX - created.width / 2,
                y: centerY - created.height / 2,
                ...(Number.isFinite(Number(action.width)) ? { width: Number(action.width) } : {}),
                ...(Number.isFinite(Number(action.height)) ? { height: Number(action.height) } : {})
              });
            }
          }

          if (typeof action.text === "string" && action.text.trim()) {
            const latest = useEditorStore.getState();
            const activeNow = latest.project.pages.find((entry) => entry.id === latest.project.activePageId);
            const target = activeNow?.bubbles[activeNow.bubbles.length - 1];
            if (target) {
              latest.updateBubble(target.id, { text: action.text });
            }
          }

          applied.push(`添加气泡「${(action.text ?? "").slice(0, 8) || "空白"}」`);
          break;
        }

        case "addPage": {
          store.addPage();
          applied.push("新增一页");
          break;
        }

        default: {
          errors.push(`不认识的操作：${String((action as { type?: string })?.type ?? "未知")}`);
        }
      }
    } catch (error) {
      errors.push(
        `${String((action as { type?: string })?.type ?? "操作")} 执行失败：` +
          (error instanceof Error ? error.message : "未知错误")
      );
    }
  }

  return { applied, errors };
}
