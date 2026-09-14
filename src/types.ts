export type CanvasPreset = "A4" | "A3" | "custom";

export type CanvasConfig = {
  width: number;
  height: number;
  preset?: CanvasPreset;
  dpi?: number;
};

export type CropConfig = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export type PanelImage = {
  original: string;
  crop?: CropConfig;
  naturalWidth?: number;
  naturalHeight?: number;
  mimeType?: string;
  preserveTransparency?: boolean;
};

export type PanelShape = {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
};

// 任意多边形顶点，使用分镜局部归一化坐标 (0..1)，随分镜缩放自动跟随
export type PanelPoint = {
  x: number;
  y: number;
};

// 分镜轮廓类型：矩形（含斜切）、任意多边形、椭圆
export type PanelShapeKind = "rect" | "polygon" | "ellipse";

export type Panel = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape: PanelShape;
  // 非空时按任意多边形渲染与裁剪，忽略 shape 四角模型
  points?: PanelPoint[];
  // 缺省按 rect 处理，保持既有数据兼容
  shapeKind?: PanelShapeKind;
  borderWidth: number;
  borderColor: string;
  borderRadius: number;
  gap: number;
  image?: PanelImage;
  parentId?: string;
};

export type BubbleType = "rect" | "rounded" | "circle" | "image";

export type BubbleDirection = "horizontal" | "vertical";

// 填字区域，相对气泡框的归一化坐标 (0..1)，气泡缩放时自动跟随
export type BubbleTextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Bubble = {
  id: string;
  type: BubbleType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  direction: BubbleDirection;
  fontSize: number;
  fontFamily: string;
  textColor: string;
  background: string;
  borderColor: string;
  borderWidth: number;
  // 图片型气泡：自定义对话框底图 (dataURL)
  image?: string;
  textBox?: BubbleTextBox;
  presetId?: string;
  // 整体不透明度 0..1，同时作用于对话框底图与文字
  opacity?: number;
  strokeText?: boolean;
  strokeColor?: string;
  strokeTextWidth?: number;
};

// 气泡预设：左侧面板的拖拽源，可导出为 JSON 复用
export type BubblePreset = {
  id: string;
  name: string;
  builtin?: boolean;
  type: BubbleType;
  width: number;
  height: number;
  textBox: BubbleTextBox;
  background: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  image?: string;
  direction: BubbleDirection;
  fontSize: number;
  fontFamily: string;
  textColor: string;
  strokeText?: boolean;
  strokeColor?: string;
  strokeTextWidth?: number;
  opacity?: number;
};

// 叠加图片层：浮在分镜之上、气泡之下，用来做前景元素增加层次
export type OverlayImage = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity?: number;
  image: string;
  naturalWidth?: number;
  naturalHeight?: number;
};

export type StoryboardMode = "storyboard" | "dialogue";

// 批量导入漫画原稿时，一张图片对应一个页面
export type PageImportItem = {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  mimeType?: string;
};

export type PageImportMode = "append" | "replace";

export type ProjectPage = {
  id: string;
  name: string;
  canvas: CanvasConfig;
  panels: Panel[];
  bubbles: Bubble[];
  // 浮在分镜之上的图片层
  overlays?: OverlayImage[];
  // 分镜模式底图颜色
  backdropColor?: string;
  // 页面底图（导入的漫画原稿），铺满整页画布
  background?: PanelImage;
};

export type Project = {
  id: string;
  name: string;
  pages: ProjectPage[];
  activePageId: string;
};

export type Selection =
  | {
      kind: "panel";
      id: string;
    }
  | {
      kind: "bubble";
      id: string;
    }
  | {
      kind: "overlay";
      id: string;
    };
