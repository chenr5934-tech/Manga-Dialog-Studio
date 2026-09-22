import { useEffect, useRef } from "react";
import {
  createSakuraField,
  drawSakura,
  drawWaves,
  WallpaperEffectKind
} from "../lib/wallpaperEffects";

type WallpaperEffectProps = {
  effect?: WallpaperEffectKind;
  // 跟着壁纸不透明度走，用户调淡背景时动效一起淡下去
  opacity: number;
};

// 背景动效的宿主。只在选中带 effect 的背景时才会挂上来，
// 其余情况连 canvas 都不存在，也就没有动画在跑。
export default function WallpaperEffect({ effect, opacity }: WallpaperEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!effect || !canvas) {
      return;
    }
    // 系统开了"减少动态效果"就不跑：静态背景本身已经成立了，
    // 这里只是锦上添花，不该让它成为眩晕的来源。
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let width = 1;
    let height = 1;
    let petals = createSakuraField(1, 1);

    const resize = () => {
      // 背景不需要 Retina 级精度，封顶 1.5 倍省一半像素
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      petals = createSakuraField(width, height);
    };
    resize();
    window.addEventListener("resize", resize);

    let frameId = 0;
    let last = performance.now();
    let elapsed = 0;

    const frame = (now: number) => {
      // 切回标签页时时间差会很大，夹住免得花瓣瞬移
      const dt = Math.min(48, now - last) / 16.67;
      last = now;

      if (!document.hidden) {
        context.clearRect(0, 0, width, height);
        if (effect === "sakura") {
          drawSakura(context, petals, width, height, dt);
        } else {
          elapsed += dt * 16.67;
          drawWaves(context, width, height, elapsed);
        }
      }
      frameId = window.requestAnimationFrame(frame);
    };
    frameId = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
    };
  }, [effect]);

  if (!effect) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      data-wallpaper-effect={effect}
      aria-hidden="true"
      className="wallpaper-effect"
      style={{ opacity: String(opacity / 100) }}
    />
  );
}
