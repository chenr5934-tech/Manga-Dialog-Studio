// 统一图标集：24 网格、1.8 描边、圆角端点。
// 之前这些位置用的是 ▲ ▼ ＋ ✕ ↥ ↧ ⇈ ⇊ 之类的 Unicode 字符，
// 字体里这些字形粗细和基线各不相同，拼在一起就像凑出来的 —— 而且是 emoji 级别的取巧。
// 全部改成同一套手绘路径，尺寸随字号走。
import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function IconBase({ size = 15, ...rest }: IconProps & { children?: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    />
  );
}

export function IconChevronUp(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 15l6-6 6 6" />
    </IconBase>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 9l6 6 6-6" />
    </IconBase>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 6l6 6-6 6" />
    </IconBase>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5.5 15A2.5 2.5 0 0 1 3 12.5V6a3 3 0 0 1 3-3h6.5A2.5 2.5 0 0 1 15 5.5" />
    </IconBase>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v5M14 11v5" />
      <path d="M6.5 7l.9 11.1A2 2 0 0 0 9.4 20h5.2a2 2 0 0 0 2-1.9L17.5 7" />
      <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
    </IconBase>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 20V5" />
      <path d="M5.5 11.5L12 5l6.5 6.5" />
    </IconBase>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4v15" />
      <path d="M18.5 12.5L12 19l-6.5-6.5" />
    </IconBase>
  );
}

export function IconToTop(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 3.5h16" />
      <path d="M12 21V8.5" />
      <path d="M6.5 14L12 8.5l5.5 5.5" />
    </IconBase>
  );
}

export function IconToBottom(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 20.5h16" />
      <path d="M12 3v12.5" />
      <path d="M17.5 10L12 15.5 6.5 10" />
    </IconBase>
  );
}

export function IconClose(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </IconBase>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </IconBase>
  );
}
