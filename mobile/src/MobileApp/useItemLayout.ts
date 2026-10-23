import { useCallback, useEffect, useRef, useState } from 'react'

/** Cached container width; typing changes only the item's span, not the data or font. */
export function useItemLayout() {
  const container = useRef<HTMLElement | null>(null)
  const observer = useRef<ResizeObserver | undefined>(undefined)
  const [width, setWidth] = useState(312)
  const measure = useCallback(() => {
    if (container.current) setWidth(container.current.clientWidth)
  }, [])
  const ref = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = undefined
    container.current = node
    if (!node) return
    // A ref update is not UI state. Measure the attached node directly so the
    // complete editor does not render once just to store its DOM reference.
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(measure)
      observer.current.observe(node)
    }
  }, [measure])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => {
      observer.current?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])
  const columns = width < 180 ? 1 : width < 260 ? 2 : 3
  const cellWidth = (width - (columns - 1) * 8) / columns
  return {
    ref,
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
