// 验算提示词里给出的版式公式：不重叠、不越界、间隙正确
const cases = [];

function check(name, W, H, rects) {
  const m = Math.min(W, H) * 0.03;
  const g = Math.min(W, H) * 0.02;
  const problems = [];
  for (const rect of rects) {
    if (rect.x < -0.01 || rect.y < -0.01) problems.push("越界(左/上)");
    if (rect.x + rect.w > W + 0.01 || rect.y + rect.h > H + 0.01) problems.push("越界(右/下)");
    if (rect.w <= 0 || rect.h <= 0) problems.push("尺寸非正");
  }
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapX > 0.01 && overlapY > 0.01) problems.push("格 " + i + " 与 " + j + " 重叠");
    }
  }
  cases.push({ name, W, H, m: Math.round(m), g: Math.round(g), problems, count: rects.length });
}

for (const [W, H] of [[2480, 3508], [1200, 2400], [1600, 1200]]) {
  const m = Math.min(W, H) * 0.03;
  const g = Math.min(W, H) * 0.02;

  // 2×2
  {
    const cw = (W - 2 * m - g) / 2;
    const ch = (H - 2 * m - g) / 2;
    const rects = [];
    for (let r = 0; r < 2; r += 1) for (let c = 0; c < 2; c += 1) {
      rects.push({ x: m + c * (cw + g), y: m + r * (ch + g), w: cw, h: ch });
    }
    check(W + "x" + H + " 2x2", W, H, rects);
  }

  // 上 1 下 2
  {
    const topH = (H - 2 * m - g) * 0.42;
    const leftW = (W - 2 * m - g) / 2;
    const bottomY = m + topH + g;
    const bottomH = H - m - bottomY;
    check(W + "x" + H + " 上1下2", W, H, [
      { x: m, y: m, w: W - 2 * m, h: topH },
      { x: m, y: bottomY, w: leftW, h: bottomH },
      { x: m + leftW + g, y: bottomY, w: leftW, h: bottomH }
    ]);
  }

  // 上 2 下 1
  {
    const topH = (H - 2 * m - g) * 0.4;
    const leftW = (W - 2 * m - g) / 2;
    const bottomY = m + topH + g;
    const bottomH = H - m - bottomY;
    check(W + "x" + H + " 上2下1", W, H, [
      { x: m, y: m, w: leftW, h: topH },
      { x: m + leftW + g, y: m, w: leftW, h: topH },
      { x: m, y: bottomY, w: W - 2 * m, h: bottomH }
    ]);
  }

  // 三行竖排
  {
    const ch = (H - 2 * m - 2 * g) / 3;
    const rects = [];
    for (let i = 0; i < 3; i += 1) rects.push({ x: m, y: m + i * (ch + g), w: W - 2 * m, h: ch });
    check(W + "x" + H + " 三行竖排", W, H, rects);
  }
}

for (const item of cases) {
  console.log(
    (item.problems.length === 0 ? "OK   " : "FAIL ") +
      item.name.padEnd(20) +
      " 格数=" + item.count +
      " 边距=" + item.m +
      " 间隙=" + item.g +
      (item.problems.length ? "  " + item.problems.join("; ") : "")
  );
}
const failed = cases.filter((item) => item.problems.length > 0);
console.log("");
console.log("结果: " + (cases.length - failed.length) + "/" + cases.length + " 组公式成立");
