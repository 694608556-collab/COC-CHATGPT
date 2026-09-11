import type { AppSettings } from './types'

export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

export interface ResolvedWindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

function visibleArea(window: Rectangle, area: Rectangle): number {
  const width = Math.max(
    0,
    Math.min(window.x + window.width, area.x + area.width) - Math.max(window.x, area.x)
  )
  const height = Math.max(
    0,
    Math.min(window.y + window.height, area.y + area.height) - Math.max(window.y, area.y)
  )
  return width * height
}

export function resolveWindowBounds(
  saved: AppSettings['windowState'],
  workAreas: Rectangle[]
): ResolvedWindowBounds {
  const primary = workAreas[0] ?? { x: 0, y: 0, width: 1920, height: 1080 }
  const width = Math.min(Math.max(saved?.width ?? 1920, 1024), primary.width)
  const height = Math.min(Math.max(saved?.height ?? 1080, 720), primary.height)
  if (saved?.x !== undefined && saved.y !== undefined) {
    const proposed = { x: saved.x, y: saved.y, width, height }
    if (workAreas.some((area) => visibleArea(proposed, area) >= 200 * 120)) {
      return { ...proposed, maximized: saved.maximized }
    }
  }
  return { width, height, maximized: saved?.maximized ?? false }
}
