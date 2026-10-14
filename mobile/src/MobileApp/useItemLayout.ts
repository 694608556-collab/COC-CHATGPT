import { useEffect, useState } from 'react'

/** Cached container width; typing changes only the item's span, not the data or font. */
export function useItemLayout() {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(312)
  useEffect(() => {
    if (!container) return
    const measure = () => setWidth(container.clientWidth)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(container)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [container])
  const columns = width < 180 ? 1 : width < 260 ? 2 : 3
  const cellWidth = (width - (columns - 1) * 8) / columns
  return {
    ref: setContainer,
    gridStyle: { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` },
    itemStyle(text: string) {
      const units = Array.from(text).reduce((total, char) => total + (char.codePointAt(0)! > 127 ? 2 : 1), 0)
      // Include input padding and its delete control; use the same spans in read/edit views.
      const wanted = units * 7 + 54
      const span = Math.max(1, Math.min(columns, Math.ceil((wanted + 8) / (cellWidth + 8))))
      return { gridColumn: `span ${span}` }
    }
  }
}
