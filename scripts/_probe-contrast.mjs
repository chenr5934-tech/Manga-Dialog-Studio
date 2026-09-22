import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 深色工具的层次靠明度差，很容易把对比度做到线以下。
// 两套主题都量一遍，逐条列出不达标的文字。
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 900 }
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8737/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1500);

const audit = () => page.evaluate(() => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((v) => Number(v.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const solidBg = (el) => {
    let node = el;
    let stacked = [];
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node);
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) stacked.push(c);
      if (c && c.a >= 0.999) break;
      node = node.parentElement;
    }
    const base = parse(getComputedStyle(document.documentElement).getPropertyValue("--bg-0")) ?? { r: 10, g: 12, b: 16, a: 1 };
    let out = base;
    for (let i = stacked.length - 1; i >= 0; i -= 1) out = blend(stacked[i], out);
    return out;
  };

  const bad = [];
  const sizes = new Map();
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
    if (!own || own.length < 2) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const s = getComputedStyle(el);
    const fgRaw = parse(s.color);
    if (!fgRaw) continue;
    const bg = solidBg(el);
    const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw;
    const cr = ratio(fg, bg);
    const size = parseFloat(s.fontSize);
    const large = size >= 18.66 || (size >= 14 && Number(s.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    sizes.set(Math.round(size), (sizes.get(Math.round(size)) ?? 0) + 1);
    if (cr < need) {
      let d = el.tagName.toLowerCase();
      if (el.className && typeof el.className === "string") d += "." + el.className.split(/\s+/).filter((c) => c.startsWith("text-[") || c.startsWith("studio-")).slice(0, 2).join(".");
      bad.push({ el: d.slice(0, 62), size, cr: Math.round(cr * 100) / 100, need, text: own.slice(0, 14), color: s.color, bg: "rgb(" + Math.round(bg.r) + "," + Math.round(bg.g) + "," + Math.round(bg.b) + ")" });
    }
  }
  const seen = new Map();
  for (const b of bad) {
    const k = b.el + b.color + b.bg;
    if (!seen.has(k)) seen.set(k, { ...b, n: 1 });
    else seen.get(k).n += 1;
  }
  return {
    theme: document.documentElement.dataset.theme ?? "dark",
    fonts: Array.from(sizes.entries()).sort((a, b) => a[0] - b[0]),
    bad: Array.from(seen.values()).sort((a, b) => a.cr - b.cr).slice(0, 12)
  };
});

for (const theme of ["dark", "light"]) {
  await page.evaluate((want) => {
    const root = document.documentElement;
    if ((root.dataset.theme ?? "dark") !== want) {
      document.querySelector(".studio-switch")?.click();
    }
  }, theme);
  await sleep(900);
  const r = await audit();
  console.log("\n########## " + r.theme + " 主题 ##########");
  console.log("字号分布：" + r.fonts.map(([s, c]) => s + "px:" + c).join("  "));
  if (r.bad.length === 0) {
    console.log("对比度：全部达标 ✓");
  } else {
    console.log("对比度不达标（" + r.bad.length + " 类）：");
    for (const b of r.bad) {
      console.log("  " + String(b.cr).padEnd(6) + "(需 " + b.need + ")  " + String(b.size).padStart(4) + "px  x" + b.n + "  " + b.el);
      console.log("         文字=" + b.color + "  底=" + b.bg + "  «" + b.text + "»");
    }
  }
}

await browser.close();
process.exitCode = 0;
