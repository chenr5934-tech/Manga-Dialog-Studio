// 壁纸的动态图层：樱花花瓣与水波纹。
//
// 两者都画在一块 fixed 的 canvas 上，尺寸跟着视口走。
// 粒子数刻意压得低（26 片花瓣、4 层波纹）：这是背景，是陪衬，
// 不该抢画面的注意力，也不该为它烧 CPU。

export type WallpaperEffectKind = "sakura" | "waves";

type Petal = {
  x: number;
  y: number;
  size: number;
  fall: number;
  sway: number;
  swaySpeed: number;
  phase: number;
  spin: number;
  angle: number;
  alpha: number;
  light: boolean;
};

const PETAL_COUNT = 26;

// 花瓣落完一轮就从顶部重新放出来，场子是固定的，不增不减
function respawn(petal: Petal, width: number, height: number, above = true) {
  petal.x = Math.random() * width;
  petal.y = above ? -petal.size * 3 - Math.random() * height * 0.4 : Math.random() * height;
  petal.size = 7 + Math.random() * 11;
  petal.fall = 0.32 + Math.random() * 0.5;
  petal.sway = 16 + Math.random() * 34;
  petal.swaySpeed = 0.006 + Math.random() * 0.009;
  petal.phase = Math.random() * Math.PI * 2;
  petal.spin = (Math.random() - 0.5) * 0.012;
  petal.angle = Math.random() * Math.PI * 2;
  petal.alpha = 0.22 + Math.random() * 0.34;
  petal.light = Math.random() > 0.45;
}

export function createSakuraField(width: number, height: number): Petal[] {
  const petals: Petal[] = [];
  for (let index = 0; index < PETAL_COUNT; index += 1) {
    const petal = {} as Petal;
    respawn(petal, width, height, false);
    petals.push(petal);
  }
  return petals;
}

// 一片花瓣的轮廓：底端收成尖、两侧鼓起来，再补一条中缝
function tracePetal(context: CanvasRenderingContext2D, size: number) {
  context.beginPath();
  context.moveTo(0, -size);
  context.bezierCurveTo(size * 0.92, -size * 0.4, size * 0.66, size * 0.6, 0, size);
  context.bezierCurveTo(-size * 0.66, size * 0.6, -size * 0.92, -size * 0.4, 0, -size);
  context.closePath();
}

export function drawSakura(
  context: CanvasRenderingContext2D,
  petals: Petal[],
  width: number,
  height: number,
  dt: number
) {
  for (const petal of petals) {
    petal.y += petal.fall * dt;
    petal.phase += petal.swaySpeed * dt;
    petal.angle += petal.spin * dt;

    if (petal.y - petal.size > height) {
      respawn(petal, width, height);
    }

    const x = petal.x + Math.sin(petal.phase) * petal.sway;
    context.save();
    context.translate(x, petal.y);
    context.rotate(petal.angle);
    context.globalAlpha = petal.alpha;
    context.fillStyle = petal.light ? "#ffd3e0" : "#f9b4cd";
    tracePetal(context, petal.size);
    context.fill();
    // 中缝，让花瓣不是一块死板的色块
    context.globalAlpha = petal.alpha * 0.5;
    context.strokeStyle = petal.light ? "#f6a8c4" : "#e88fae";
    context.lineWidth = Math.max(0.6, petal.size * 0.05);
    context.beginPath();
    context.moveTo(0, -petal.size * 0.75);
    context.lineTo(0, petal.size * 0.85);
    context.stroke();
    context.restore();
  }
  context.globalAlpha = 1;
}

// 四层不同频率的正弦线叠出水面起伏，越往下振幅越大、越亮
export function drawWaves(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsed: number
) {
  for (let layer = 0; layer < 4; layer += 1) {
    const baseY = height * (0.3 + layer * 0.175);
    const amplitude = 9 + layer * 7;
    const frequency = 0.0034 + layer * 0.001;
    const drift = elapsed * (0.00016 + layer * 0.00007);

    context.beginPath();
    for (let x = 0; x <= width + 8; x += 8) {
      const y =
        baseY +
        Math.sin(x * frequency + drift) * amplitude +
        Math.sin(x * frequency * 2.6 - drift * 1.7) * amplitude * 0.35;
      if (x === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.strokeStyle = "rgba(132, 204, 255, " + (0.05 + layer * 0.028).toFixed(3) + ")";
    context.lineWidth = 1.3 + layer * 0.6;
    context.stroke();
  }

  // 水面上几道更亮的高光，做出波光的层次
  for (let glint = 0; glint < 3; glint += 1) {
    const baseY = height * (0.42 + glint * 0.16);
    const drift = elapsed * (0.00011 + glint * 0.00005);
    const amplitude = 6 + glint * 4;
    const frequency = 0.006 + glint * 0.0016;
    context.beginPath();
    for (let x = 0; x <= width + 8; x += 10) {
      const y = baseY + Math.sin(x * frequency + drift) * amplitude;
      if (x === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.strokeStyle = "rgba(190, 232, 255, " + (0.06 - glint * 0.012).toFixed(3) + ")";
    context.lineWidth = 0.9;
    context.stroke();
  }
}
