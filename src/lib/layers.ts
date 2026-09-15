import { ProjectPage, Selection } from "../types";

// 画布上的东西原本分三个数组各管各的（分镜 / 图片层与贴纸 / 气泡），
// 渲染顺序写死成「分镜 → 图片层 → 气泡」。这样一旦有东西铺满画布，
// 下面的就再也点不中，也没法调整。
//
// 这里引入一条统一的层序：page.layerOrder 记 id 排列，渲染按它来。
// 老项目没有这个字段，就按原来的三类默认顺序补出来，行为不变。

export type LayerEntry = {
  id: string;
  kind: "panel" | "overlay" | "bubble";
  label: string;
  detail: string;
};

// 默认层序：分镜在最下，图片层与贴纸压在分镜上，气泡在最上
export function resolveLayerOrder(page: ProjectPage): string[] {
  const stored = Array.isArray(page.layerOrder) ? page.layerOrder : [];
  const known = new Set<string>();
  const valid: string[] = [];

  for (const id of stored) {
    const exists =
      page.panels.some((item) => item.id === id) ||
      (page.overlays ?? []).some((item) => item.id === id) ||
      page.bubbles.some((item) => item.id === id);
    if (exists && !known.has(id)) {
      known.add(id);
      valid.push(id);
    }
  }

  // 新加进来的对象按默认分区补上：分镜在下、图片层居中、气泡在上
  const append = (id: string) => {
    if (!known.has(id)) {
      known.add(id);
      valid.push(id);
    }
  };
  page.panels.forEach((item) => append(item.id));
  (page.overlays ?? []).forEach((item) => append(item.id));
  page.bubbles.forEach((item) => append(item.id));

  // 上面按「分镜 → 图片层 → 气泡」的顺序追加，正好等于老的渲染顺序
  return valid;
}

// 按层序列出画布上的一切，从最底层到最顶层
export function listLayers(page: ProjectPage): LayerEntry[] {
  const order = resolveLayerOrder(page);
  const byId = new Map<string, LayerEntry>();

  for (const panel of page.panels) {
    byId.set(panel.id, {
      id: panel.id,
      kind: "panel",
      label: "分镜",
      detail: describePanel(panel)
    });
  }
  for (const overlay of page.overlays ?? []) {
    byId.set(overlay.id, {
      id: overlay.id,
      kind: "overlay",
      label: overlay.sticker ? "贴纸" : "图片层",
      detail: overlay.sticker
        ? "贴纸 · " + Math.round(overlay.width) + "×" + Math.round(overlay.height)
        : "图片层 · " + Math.round(overlay.width) + "×" + Math.round(overlay.height)
    });
  }
  for (const bubble of page.bubbles) {
    byId.set(bubble.id, {
      id: bubble.id,
      kind: "bubble",
      label: "气泡",
      detail: bubble.text ? "「" + bubble.text.slice(0, 12) + "」" : "（空文字）"
    });
  }

  return order
    .map((id) => byId.get(id))
    .filter((item): item is LayerEntry => Boolean(item));
}

function describePanel(panel: ProjectPage["panels"][number]): string {
  const shape = panel.shapeKind === "ellipse" ? "椭圆" : panel.points?.length ? "多边形" : "矩形";
  return shape + " · " + Math.round(panel.width) + "×" + Math.round(panel.height);
}

export type LayerMove = "up" | "down" | "top" | "bottom";

// 在层序里挪动一个对象。返回新的完整顺序，没变化时返回 null。
export function moveLayerInOrder(order: string[], id: string, move: LayerMove): string[] | null {
  const index = order.indexOf(id);
  if (index < 0) {
    return null;
  }

  const next = [...order];
  next.splice(index, 1);

  if (move === "top") {
    next.push(id);
  } else if (move === "bottom") {
    next.unshift(id);
  } else if (move === "up") {
    const target = Math.min(order.length - 1, index + 1);
    next.splice(target, 0, id);
  } else {
    const target = Math.max(0, index - 1);
    next.splice(target, 0, id);
  }

  return next.join("|") === order.join("|") ? null : next;
}

export function selectionOf(entry: LayerEntry): Selection {
  return { kind: entry.kind, id: entry.id } as Selection;
}
