interface IconProps {
  size?: number
  className?: string
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true
  }
}

export function SolidTriangleIcon({
  size = 16,
  className
}: IconProps): React.JSX.Element {
  return (
    <svg {...base(size, className)} fill="currentColor" stroke="none">
      <path d="M7.5 5.75c-.92-.53-2.05.13-2.05 1.19v10.12c0 1.06 1.13 1.72 2.05 1.19l8.78-5.06a1.37 1.37 0 0 0 0-2.38z" />
    </svg>
  )
}

export function FolderIcon({
  size = 16,
  className
}: IconProps): React.JSX.Element {
  return (
    <svg {...base(size, className)}>
      <path d="M3 7.5h6l2 2h10v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 7.5V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1.5" />
    </svg>
  )
}

export function PencilIcon({
  size = 16,
  className
}: IconProps): React.JSX.Element {
  return (
    <svg {...base(size, className)}>
      <path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
      <path d="m13.8 7.2 3 3" />
    </svg>
  )
}

export function PlusIcon({
  size = 16,
  className
}: IconProps): React.JSX.Element {
  return (
    <svg {...base(size, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** 更新：环形箭头，用于「重新指定这个资料对应的文件」 */
export function RefreshIcon({
  size = 16,
  className
}: IconProps): React.JSX.Element {
  return (
    <svg {...base(size, className)}>
      <path d="M20 11a8 8 0 1 0-.6 3" />
      <path d="M20 4.5V11h-6.5" />
    </svg>
  )
}

export function XIcon({
  size = 16,
  className
}: IconProps): React.JSX.Element {
  return (
    <svg {...base(size, className)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function ArrowUpIcon({
  size = 16,
  className
}: IconProps): React.JSX.Element {
  return (
    <svg {...base(size, className)}>
      <path d="m6 14 6-6 6 6" />
    </svg>
  )
}

export function ArrowDownIcon({
  size = 16,
  className
}: IconProps): React.JSX.Element {
  return (
    <svg {...base(size, className)}>
      <path d="m6 10 6 6 6-6" />
    </svg>
  )
}

/**
 * Windows 10 标题栏控件图标。
 *
 * 这几个刻意不共用 base()：Win10 的字形是 10×10、1px 细线、平头端点，
 * 坐标落在半像素上才够锐利；base() 的 24 格画布配 1.8 描边和圆头端点
 * 会明显偏粗、偏圆，看着就不像系统控件了。
 */
function caption(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 10 10',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1,
    strokeLinecap: 'butt' as const,
    strokeLinejoin: 'miter' as const,
    shapeRendering: 'crispEdges' as const,
    className,
    'aria-hidden': true
  }
}

/** 最小化：一条居中的横线 */
export function MinimizeIcon({ size = 10, className }: IconProps): React.JSX.Element {
  return (
    <svg {...caption(size, className)}>
      <path d="M0 5.5h10" />
    </svg>
  )
}

/** 最大化：一个 10×10 的方框 */
export function MaximizeIcon({ size = 10, className }: IconProps): React.JSX.Element {
  return (
    <svg {...caption(size, className)}>
      <path d="M0.5 0.5h9v9h-9z" />
    </svg>
  )
}

/** 还原：两个错位叠放的方框（最大化状态下显示） */
export function RestoreIcon({ size = 10, className }: IconProps): React.JSX.Element {
  return (
    <svg {...caption(size, className)}>
      <path d="M2.5 0.5h7v7" />
      <path d="M0.5 2.5h7v7h-7z" />
    </svg>
  )
}

/** 关闭：一个 10×10 的叉 */
export function CloseIcon({ size = 10, className }: IconProps): React.JSX.Element {
  return (
    <svg {...caption(size, className)}>
      <path d="M0 0l10 10M10 0L0 10" />
    </svg>
  )
}
