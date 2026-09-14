import { Image as KonvaImage, Path } from "react-konva";
import useImage from "use-image";
import { OverlayImage } from "../types";
import { getStickerDef } from "../lib/stickers";

// 位图分支：导入的图片按原图铺满叠加层范围
function OverlayBitmap({ overlay }: { overlay: OverlayImage }) {
  const [image] = useImage(overlay.image, "anonymous");

  if (!image) {
    return null;
  }

  return (
    <KonvaImage
      image={image}
      x={0}
      y={0}
      width={overlay.width}
      height={overlay.height}
      listening={false}
    />
  );
}

// 自定义贴纸：用户导入的位图，按原图铺满
function StickerBitmap({ url, width, height }: { url: string; width: number; height: number }) {
  const [image] = useImage(url, "anonymous");

  if (!image) {
    return null;
  }

  return <KonvaImage image={image} x={0} y={0} width={width} height={height} listening={false} />;
}

// 贴纸分支：内置的走矢量路径（放大不会糊、换色即时），自定义的走位图
function OverlaySticker({ overlay }: { overlay: OverlayImage }) {
  const sticker = overlay.sticker;

  if (!sticker) {
    return null;
  }

  if (sticker.image) {
    return <StickerBitmap url={sticker.image} width={overlay.width} height={overlay.height} />;
  }

  const def = getStickerDef(sticker.id);
  if (!def) {
    return null;
  }

  const color = sticker.color ?? def.defaultColor;
  // 贴纸坐标系是 100x100，按叠加层尺寸等比缩放；描边随之等比，粗细微调不会失真
  const scaleX = overlay.width / def.viewBox;
  const scaleY = overlay.height / def.viewBox;

  if (def.mode === "stroke") {
    return (
      <Path
        data={def.path}
        x={0}
        y={0}
        scaleX={scaleX}
        scaleY={scaleY}
        stroke={color}
        strokeWidth={def.strokeWidth ?? 8}
        lineCap={def.lineCap ?? "round"}
        lineJoin="round"
        listening={false}
      />
    );
  }

  return (
    <Path data={def.path} x={0} y={0} scaleX={scaleX} scaleY={scaleY} fill={color} listening={false} />
  );
}

// 叠加层的画面：贴纸走矢量分支，图片层走位图分支
export default function OverlayArtwork({ overlay }: { overlay: OverlayImage }) {
  if (overlay.sticker) {
    return <OverlaySticker overlay={overlay} />;
  }

  return <OverlayBitmap overlay={overlay} />;
}
