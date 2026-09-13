import { Ellipse, Image as KonvaImage, Rect, Text } from "react-konva";
import useImage from "use-image";
import { Bubble, BubbleTextBox } from "../types";

// 未显式设置填字区域时，退化为整框内缩 10px，保证旧数据与形状气泡表现一致
export function resolveTextBox(bubble: Pick<Bubble, "textBox" | "width" | "height">): BubbleTextBox {
  if (bubble.textBox) {
    return bubble.textBox;
  }

  const insetX = Math.min(10 / Math.max(1, bubble.width), 0.2);
  const insetY = Math.min(10 / Math.max(1, bubble.height), 0.2);
  return {
    x: insetX,
    y: insetY,
    width: Math.max(0.05, 1 - insetX * 2),
    height: Math.max(0.05, 1 - insetY * 2)
  };
}

// 未设置时视为完全不透明
export function resolveBubbleOpacity(bubble: Pick<Bubble, "opacity">): number {
  return typeof bubble.opacity === "number" && Number.isFinite(bubble.opacity)
    ? Math.min(1, Math.max(0, bubble.opacity))
    : 1;
}

export function toVerticalText(text: string) {
  return text
    .split("\n")
    .map((line) => line.split("").join("\n"))
    .join("\n\n");
}

type LayerProps = {
  bubble: Bubble;
  listening?: boolean;
};

// 气泡底图：图片型走自定义对话框素材，形状型回退到几何绘制
export function BubbleShapeLayer({ bubble, listening = true }: LayerProps) {
  const [image] = useImage(bubble.image ?? "", "anonymous");

  if (bubble.image) {
    if (!image) {
      return null;
    }

    return (
      <KonvaImage
        image={image}
        x={0}
        y={0}
        width={bubble.width}
        height={bubble.height}
        listening={listening}
      />
    );
  }

  if (bubble.type === "circle") {
    return (
      <Ellipse
        x={bubble.width / 2}
        y={bubble.height / 2}
        radiusX={bubble.width / 2}
        radiusY={bubble.height / 2}
        fill={bubble.background}
        stroke={bubble.borderColor}
        strokeWidth={bubble.borderWidth}
        listening={listening}
      />
    );
  }

  return (
    <Rect
      width={bubble.width}
      height={bubble.height}
      fill={bubble.background}
      stroke={bubble.borderColor}
      strokeWidth={bubble.borderWidth}
      cornerRadius={bubble.type === "rounded" ? 30 : 8}
      listening={listening}
    />
  );
}

export function BubbleTextLayer({ bubble, listening = false }: LayerProps) {
  const box = resolveTextBox(bubble);
  const text = bubble.direction === "vertical" ? toVerticalText(bubble.text) : bubble.text;
  const strokeWidth = bubble.strokeText
    ? Math.max(0, bubble.strokeTextWidth ?? Math.max(3, Math.round(bubble.fontSize * 0.16)))
    : 0;

  return (
    <Text
      x={box.x * bubble.width}
      y={box.y * bubble.height}
      width={Math.max(10, box.width * bubble.width)}
      height={Math.max(10, box.height * bubble.height)}
      text={text}
      align="center"
      verticalAlign="middle"
      fontSize={bubble.fontSize}
      fontFamily={bubble.fontFamily}
      fill={bubble.textColor}
      stroke={strokeWidth > 0 ? bubble.strokeColor ?? "#ffffff" : undefined}
      strokeWidth={strokeWidth}
      fillAfterStrokeEnabled
      lineHeight={1.2}
      wrap="word"
      listening={listening}
    />
  );
}
