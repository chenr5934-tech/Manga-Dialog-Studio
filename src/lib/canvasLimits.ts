// 浏览器 canvas 的硬上限。实测（Chrome，本机）：
//   12000×16000 = 192MP  → toDataURL 正常，726ms
//   16000×22000 = 352MP  → toDataURL **不抛错**，直接返回 "data:,"（空串）
// 也就是说超限之后的失败是静默的：导出"完成"，产物是个打不开的空文件。
// 这个文件里的数字就是用来把那条路堵死的。
//
// 画布本身限制得比导出更紧：导出还要乘 pixelRatio，
// 2x 导出时像素数是画布的四倍。
export const MIN_CANVAS_EDGE = 240;
export const MAX_CANVAS_EDGE = 12000;
export const MAX_CANVAS_PIXELS = 40_000_000;
export const MAX_EXPORT_PIXELS = 200_000_000;

export function clampCanvasSize(
  width: number,
  height: number
): { width: number; height: number; clamped: boolean } {
  const requestedWidth = Math.max(MIN_CANVAS_EDGE, Math.round(Number(width) || 0));
  const requestedHeight = Math.max(MIN_CANVAS_EDGE, Math.round(Number(height) || 0));
  let nextWidth = Math.min(MAX_CANVAS_EDGE, requestedWidth);
  let nextHeight = Math.min(MAX_CANVAS_EDGE, requestedHeight);
  let clamped = nextWidth !== requestedWidth || nextHeight !== requestedHeight;

  const pixels = nextWidth * nextHeight;
  if (pixels > MAX_CANVAS_PIXELS) {
    // 按比例缩，别把用户要的长宽比改掉
    const scale = Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    nextWidth = Math.max(MIN_CANVAS_EDGE, Math.round(nextWidth * scale));
    nextHeight = Math.max(MIN_CANVAS_EDGE, Math.round(nextHeight * scale));
    clamped = true;
  }

  return { width: nextWidth, height: nextHeight, clamped };
}

// 导出前的体检：算上 pixelRatio 之后会不会超过浏览器能画的上限
export function exportPixelCount(width: number, height: number, pixelRatio: number): number {
  return Math.round(width * pixelRatio) * Math.round(height * pixelRatio);
}
