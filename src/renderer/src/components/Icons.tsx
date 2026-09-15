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
