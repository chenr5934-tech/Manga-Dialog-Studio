import { useEditorStore } from "./store";

// Agent 能执行的操作。范围刻意收窄：只暴露可撤销、不破坏文件的操作。
export type AgentAction =
  | { type: "setCanvasSize"; width: number; height: number }
  | { type: "splitGrid"; rows: number; cols: number }
  | { type: "clearPanels" }
  | { type: "clearBubbles" }
  | { type: "addPanel"; x: number; y: number; width: number; height: number }
  | { type: "addPolygonPanel"; points: { x: number; y: number }[] }
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

export type AgentScope = { x: number; y: number; width: number; height: number };

// 参考图统一压到长边 1280 以内再传，避免请求体和 token 失控。
// 漫画是线稿，JPEG 0.85 足够让模型看清分镜结构。
export async function compressReferenceImage(file: File, maxSide = 1280): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("图片解码失败"));
    element.src = dataUrl;
  });

  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longest > maxSide ? maxSide / longest : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return dataUrl;
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export type AgentContext = {
  canvasWidth: number;
  canvasHeight: number;
  pageCount: number;
  activePageIndex: number;
  panelCount: number;
  bubbleCount: number;
  backdropColor: string;
  presetNames: string[];
  scope: AgentScope | null;
};

// 新增内容时中心点必须落在限定范围内，越界直接跳过而不是悄悄塞进去
function centerWithinScope(scope: AgentScope, x: number, y: number, width: number, height: number): boolean {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return (
    centerX >= scope.x &&
    centerX <= scope.x + scope.width &&
    centerY >= scope.y &&
    centerY <= scope.y + scope.height
  );
}

function pointsRoughlyWithinScope(scope: AgentScope, points: { x: number; y: number }[]): boolean {
  if (points.length === 0) {
    return true;
  }
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return centerWithinScope(scope, sum.x / points.length, sum.y / points.length, 0, 0);
}

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
    presetNames: state.bubblePresets.map((preset) => preset.name),
    scope: state.agentScope
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
    '- {"type":"addPanel","x":数字,"y":数字,"width":数字,"height":数字}  指定位置加一个矩形分镜',
    '- {"type":"addPolygonPanel","points":[{"x":数字,"y":数字},...]}  加一个任意多边形分镜，至少 3 个顶点，按顺时针给出',
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
    "如果用户提供了一张参考漫画图并要求复刻排版：",
    "1. 先看清整页被分成几行几列，是规则网格还是大小不一的格子。",
    "2. 规则网格用 splitGrid 复刻；行列不等宽、或有格子跨行跨列的，改用多次 addPanel 逐个给出坐标。",
    "3. 按参考图的长宽比设置画布尺寸，例如竖版条漫用 1200×2400 这样的比例。",
    "4. 图中有对话框时，按其大致位置与尺寸加 addBubble，文字照抄；看不清就写占位文字。",
    "5. 只复刻排版结构，不要试图还原画风、人物或网点细节。",
    "",
    "当前画布状态（仅供参考）：",
    "- 画布尺寸：" + context.canvasWidth + " x " + context.canvasHeight + " 像素",
    "- 当前是第 " + (context.activePageIndex + 1) + " 页，共 " + context.pageCount + " 页",
    "- 当前页已有分镜 " + context.panelCount + " 个、气泡 " + context.bubbleCount + " 个",
    "- 页面底色：" + context.backdropColor,
    "- 可用的气泡预设名：" + (context.presetNames.join("、") || "（无）"),
    context.scope
      ? [
          "",
          "【重要】用户已框定作用范围，你只能在该范围内新增内容，越界会被系统拒绝：",
          "- 范围左上角 x=" + Math.round(context.scope.x) + "，y=" + Math.round(context.scope.y),
          "- 范围尺寸 " + Math.round(context.scope.width) + " × " + Math.round(context.scope.height),
          "- 所有新增的 x 必须落在 " +
            Math.round(context.scope.x) +
            " 到 " +
            Math.round(context.scope.x + context.scope.width) +
            " 之间，y 落在 " +
            Math.round(context.scope.y) +
            " 到 " +
            Math.round(context.scope.y + context.scope.height) +
            " 之间",
          "- 不要把任何分镜或气泡放在范围之外"
        ].join("\n")
      : ""
  ]
    .filter(Boolean)
    .join("\n");
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
  // 取一次快照，执行途中范围不会被改掉
  const scope = store.agentScope;

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

          if (scope && !centerWithinScope(scope, x, y, width, height)) {
            errors.push("分镜超出限定范围，已跳过");
            break;
          }

          store.createPanelFromRect(x, y, width, height);
          applied.push(`新增分镜 (${Math.round(x)}, ${Math.round(y)})`);
          break;
        }

        case "addPolygonPanel": {
          const rawPoints = Array.isArray(action.points) ? action.points : [];
          const points = rawPoints
            .map((point) => ({ x: safeNumber(point?.x, NaN), y: safeNumber(point?.y, NaN) }))
            .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

          if (points.length < 3) {
            errors.push("多边形至少需要 3 个有效顶点");
            break;
          }

          if (scope && !pointsRoughlyWithinScope(scope, points)) {
            errors.push("多边形超出限定范围，已跳过");
            break;
          }

          store.createPolygonPanelFromPoints(points);
          applied.push(`新增 ${points.length} 边形分镜`);
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

          if (scope && !centerWithinScope(scope, centerX, centerY, 0, 0)) {
            errors.push(
              `气泡超出限定范围，已跳过（${Math.round(centerX)}, ${Math.round(centerY)}）`
            );
            break;
          }

          // 预设名允许模糊匹配：模型偶尔只写"旁白框"而不是完整的"旁白框 · 方角"
          const wanted = String(action.presetName ?? "").trim();
          const matched = wanted
            ? (page.bubblePresets.find((preset) => preset.name === wanted) ??
              page.bubblePresets.find(
                (preset) => preset.name.includes(wanted) || wanted.includes(preset.name)
              ))
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
