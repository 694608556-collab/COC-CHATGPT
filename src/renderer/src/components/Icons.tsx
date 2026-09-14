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

export function ChevronIcon({
  size = 16,
  className
}: IconProps): React.JSX.Element {
  return (
    <svg {...base(size, className)}>
      <path d="m8 10 4 4 4-4" />
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

export function TrashIcon({
  size = 16,
  className
}: IconProps): React.JSX.Element {
  return (
    <svg {...base(size, className)}>
      <path d="M4 7h16M9 7V4h6v3" />
      <path d="m7 7 1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
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
