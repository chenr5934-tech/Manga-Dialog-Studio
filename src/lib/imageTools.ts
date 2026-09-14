// 图片处理工具：在本地把分镜素材的背景抠掉，不依赖任何外部服务。

export type RgbColor = { r: number; g: number; b: number };

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = src;
  });
}

type CanvasLike = {
  image: HTMLImageElement;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
};

async function toCanvas(source: string): Promise<CanvasLike> {
  const image = await loadImageElement(source);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("无法创建画布上下文");
  }
  context.drawImage(image, 0, 0);
  return { image, canvas, context };
}

// 取四角与四边中点的常见颜色作为背景色推断，纯色背景基本都能命中
export async function detectBackgroundColor(source: string): Promise<RgbColor> {
  const { canvas, context } = await toCanvas(source);
  const width = canvas.width;
  const height = canvas.height;
  const inset = Math.max(1, Math.round(Math.min(width, height) * 0.02));

  const samples: [number, number][] = [
    [inset, inset],
    [width - inset - 1, inset],
    [inset, height - inset - 1],
    [width - inset - 1, height - inset - 1],
    [Math.floor(width / 2), inset],
    [Math.floor(width / 2), height - inset - 1],
    [inset, Math.floor(height / 2)],
    [width - inset - 1, Math.floor(height / 2)]
  ];

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (const [x, y] of samples) {
    const safeX = Math.min(width - 1, Math.max(0, x));
    const safeY = Math.min(height - 1, Math.max(0, y));
    const data = context.getImageData(safeX, safeY, 1, 1).data;
    // 量化到 16 级，避免抗锯齿造成的细微差异把统计打散
    const key = [data[0], data[1], data[2]].map((value) => Math.round(value / 16)).join("-");
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += data[0];
      bucket.g += data[1];
      bucket.b += data[2];
    } else {
      buckets.set(key, { count: 1, r: data[0], g: data[1], b: data[2] });
    }
  }

  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) {
      best = bucket;
    }
  }

  if (!best) {
    return { r: 255, g: 255, b: 255 };
  }

  return {
    r: Math.round(best.r / best.count),
    g: Math.round(best.g / best.count),
    b: Math.round(best.b / best.count)
  };
}

export type RemoveBackgroundOptions = {
  color: RgbColor;
  // 颜色距离阈值，越大去掉的越多
  tolerance: number;
  // 边缘过渡带宽度，避免留下硬锯齿
  feather: number;
};

export type RemoveBackgroundResult = {
  dataUrl: string;
  removedRatio: number;
};

// 把接近背景色的像素置为透明。容差内全透明，容差外留一个过渡带做羽化。
export async function removeSolidBackground(
  source: string,
  options: RemoveBackgroundOptions
): Promise<RemoveBackgroundResult> {
  const { canvas, context } = await toCanvas(source);
  const { width, height } = canvas;

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const { color, tolerance, feather } = options;
  const safeTolerance = Math.max(0, tolerance);
  const safeFeather = Math.max(0, feather);
  const outer = safeTolerance + safeFeather;

  let removed = 0;
  const total = width * height;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];

    // 用欧氏距离衡量颜色接近程度
    const distance = Math.sqrt(
      (r - color.r) * (r - color.r) + (g - color.g) * (g - color.g) + (b - color.b) * (b - color.b)
    );

    if (distance <= safeTolerance) {
      data[index + 3] = 0;
      removed += 1;
      continue;
    }

    if (safeFeather > 0 && distance < outer) {
      // 过渡带内按距离线性降低不透明度
      const ratio = (distance - safeTolerance) / safeFeather;
      data[index + 3] = Math.round(data[index + 3] * Math.min(1, Math.max(0, ratio)));
    }
  }

  context.putImageData(imageData, 0, 0);
  return {
    dataUrl: canvas.toDataURL("image/png"),
    removedRatio: total > 0 ? removed / total : 0
  };
}
