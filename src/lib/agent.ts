import { useEditorStore } from "./store";
import { AgentSkill, formatSkillCatalog } from "./agentSkills";

// Agent 能执行的操作。范围刻意收窄：只暴露可撤销、不破坏文件的操作。
export type AgentAction =
  | { type: "setCanvasSize"; width: number; height: number }
  | { type: "splitGrid"; rows: number; cols: number; gap?: number }
  | { type: "clearPanels" }
  | { type: "clearBubbles" }
  | { type: "addPanel"; x: number; y: number; width: number; height: number }
  | { type: "addEllipsePanel"; x?: number; y?: number; width?: number; height?: number }
  | { type: "addPolygonPanel"; points: { x: number; y: number }[] }
  | { type: "setBackdropColor"; color: string }
  | {
      type: "setPanelStyle";
      borderRadius?: number;
      chamferRadius?: number;
      cornerMode?: "round" | "chamfer";
      borderWidth?: number;
      borderColor?: string;
      gap?: number;
    }
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
  // 模型要求加载的技能 id；加载完再给 actions
  requestedSkills: string[];
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
  // 用户在模型设置里写的附加要求，会注入到提示词末尾
  systemPromptExtra?: string;
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

export function buildSystemPrompt(
  context: AgentContext,
  customPrompt?: string,
  loadedSkills: AgentSkill[] = []
): string {
  const extra = String(customPrompt ?? "").trim();
  // 技能目录常驻在提示词里；一旦模型点名要哪个，就把该技能的正文整块补进去
  const skillBlock = loadedSkills.length
    ? [
        "",
        "【已加载的技能正文】",
        "下面是完整指导，请据此给出最终 actions。",
        ...loadedSkills.map((skill) => "\n### " + skill.name + "（" + skill.id + "）\n" + skill.body)
      ].join("\n")
    : [
        "",
        "【可用技能：按需加载】",
        "遇到需要真正排版判断的请求（分格节奏、构图取景、气泡布局、照着参考图复刻），先要求加载对应技能：",
        '在 JSON 里加 "skills": ["技能 id"]，并把 actions 设为空数组；系统会把技能正文发给你，你在下一轮再给出真正的 actions。',
        "",
        formatSkillCatalog(),
        "",
        "简单直接的请求（加一个气泡、改画布尺寸、清空分镜）不必加载技能，直接给 actions。一次最多加载 2 个最相关的技能。"
      ].join("\n");
  return [
    "你是漫画分镜排版助手，负责把用户的中文指令转换成一组可执行操作。",
    "",
    "只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码围栏。格式：",
    '{"summary": "一句话说明你要做什么", "actions": [ {"type": "...", ...} ]}',
    skillBlock,
    "",
    "【可用操作】",
    '- {"type":"setCanvasSize","width":数字,"height":数字}  设定当前页画布尺寸',
    '- {"type":"splitGrid","rows":数字,"cols":数字,"gap":数字}  整页均分为网格（会替换现有分镜）；gap 是分镜之间的留白像素，务必给合适的值',
    '- {"type":"clearPanels"}  清空当前页所有分镜',
    '- {"type":"clearBubbles"}  清空当前页所有文字',
    '- {"type":"addPanel","x":数字,"y":数字,"width":数字,"height":数字}  指定位置加一个矩形分镜',
    '- {"type":"addEllipsePanel","x":数字,"y":数字,"width":数字,"height":数字}  加一个椭圆分镜，用于圆形/椭圆形取景',
    '- {"type":"addPolygonPanel","points":[{"x":数字,"y":数字},...]}  加一个任意多边形分镜，至少 3 个顶点，按顺时针给出',
    '- {"type":"setPanelStyle","borderRadius":数字,"borderWidth":数字,"borderColor":"#RRGGBB","gap":数字}  批量设置所有分镜样式',
    '- {"type":"setBackdropColor","color":"#RRGGBB"}  设置页面底色',
    '- {"type":"addBubble","x":数字,"y":数字,"width":数字,"height":数字,"text":"文字","presetName":"预设名"}  加一个气泡，x/y 是气泡中心点',
    '- {"type":"addPage"}  在末尾新增一页',
    "",
    "【硬性约束】",
    "1. 坐标是画布像素，原点在左上角；除注明外 x/y 指左上角。",
    "2. 所有内容必须落在画布范围内。",
    "3. 一页分镜通常不超过 9 个，气泡不超过 12 个。",
    "4. splitGrid 会替换已有分镜；要保留现有分镜再追加，请用 addPanel。",
    "5. 用户没有明确要求就不要改颜色。",
    "6. 只使用上面列出的操作类型，不要发明新类型。",
    "7. actions 数组可以为空，但必须存在。",
    "",
    "【留白：很重要】",
    "分镜之间必须留出明显间隙，绝不能切得严丝合缝——贴在一起的分镜连边框都分不清。",
    "用 splitGrid 的 gap 指定，参考值为画布短边的 2% 左右：",
    "例如 2480 宽的页面用 gap 50 上下，小的格子漫画可以用 30～40，最多不要超过 120。",
    "用 addPanel 逐个摆放时，相邻分镜之间同样要手动留出这个间隙。",
    "",
    "【复刻参考图的规矩：很重要】",
    "当用户给了一张参考漫画图并要求复刻排版时：",
    "1. 先判断版面结构：分成几行几列、格子是否等大、有没有跨行跨列的大格、有没有斜切或圆形格子。",
    "2. 规则网格用 splitGrid；大小不一的用多次 addPanel 逐个给出坐标；圆形格子用 addEllipsePanel。",
    "3. 按参考图的长宽比设置画布尺寸，例如竖版条漫用 1200×2400 这样的比例。",
    "4. 相邻分镜之间要留出间隙，参考图里本来就有间隙，不要把它抹平。",
    "5. 参考图里的对话框可以按位置和尺寸加上，但【绝对不要照抄图里的文字】——",
    "   text 一律留空写 \"\"，用户要的是能反复套用的版式，文字由他自己填。",
    "6. 只复刻版面结构，不要去还原画风、人物、网点、手写字或对白内容。",
    "",
    "【当前画布】",
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
      : "",
    extra
      ? ["", "【用户附加要求】", "在不违反上面输出格式的前提下优先遵循：", extra].join("\n")
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
      const parsed = JSON.parse(candidate) as Partial<AgentPlan> & { skills?: unknown };
      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      // 模型可以先只要技能正文（actions 留空），拿到指导后下一轮再给操作
      const hasActions = Array.isArray(parsed.actions);
      const requestedSkills = Array.isArray(parsed.skills)
        ? parsed.skills.filter((item): item is string => typeof item === "string")
        : [];
      if (!hasActions && requestedSkills.length === 0) {
        continue;
      }

      return {
        summary: typeof parsed.summary === "string" ? parsed.summary : "已生成排版方案",
        actions: hasActions ? (parsed.actions as AgentAction[]) : [],
        requestedSkills
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
          const rawGap = Number(action.gap);
          const gap = Number.isFinite(rawGap) ? Math.min(240, Math.max(0, Math.round(rawGap))) : undefined;
          store.splitGrid(rows, cols, gap);
          applied.push(
            `切分为 ${rows} 行 × ${cols} 列` + (gap === undefined ? "" : `（留白 ${gap}）`)
          );
          break;
        }

        case "addEllipsePanel": {
          const page = useEditorStore.getState();
          const project = page.project;
          const activePage = project.pages.find((entry) => entry.id === project.activePageId);
          const canvas = activePage?.canvas ?? { width: 2480, height: 3508 };
          const width = Math.max(60, safeNumber(action.width, canvas.width * 0.45));
          const height = Math.max(60, safeNumber(action.height, canvas.height * 0.28));
          const x = safeNumber(action.x, (canvas.width - width) / 2);
          const y = safeNumber(action.y, (canvas.height - height) / 2);

          if (scope && !centerWithinScope(scope, x, y, width, height)) {
            errors.push("椭圆分镜超出限定范围，已跳过");
            break;
          }

          page.createEllipsePanelFromRect(x, y, width, height);
          applied.push("新增椭圆分镜");
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
          const style: {
            borderRadius?: number;
            chamferRadius?: number;
            cornerMode?: "round" | "chamfer";
            borderWidth?: number;
            borderColor?: string;
            gap?: number;
          } = {};
          if (Number.isFinite(Number(action.borderRadius))) {
            style.borderRadius = Math.max(0, Number(action.borderRadius));
          }
          if (Number.isFinite(Number(action.chamferRadius))) {
            style.chamferRadius = Math.max(0, Number(action.chamferRadius));
          }
          if (action.cornerMode === "round" || action.cornerMode === "chamfer") {
            style.cornerMode = action.cornerMode;
          }
          if (Number.isFinite(Number(action.borderWidth))) {
            style.borderWidth = Math.max(0, Number(action.borderWidth));
          }
          if (HEX_COLOR.test(String(action.borderColor ?? ""))) {
            style.borderColor = String(action.borderColor);
          }
          if (Number.isFinite(Number(action.gap))) {
            style.gap = Math.max(0, Number(action.gap));
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
