import { useEffect, useState } from 'react'

/** 可见区域使用布局视口坐标；无 VisualViewport 时回退窗口尺寸。 */
export function visibleViewport() {
  const view = window.visualViewport
  return {
    top: view?.offsetTop ?? 0,
    left: view?.offsetLeft ?? 0,
    width: view?.width ?? innerWidth,
    height: view?.height ?? innerHeight
  }
}

/** Convert layout bounds to the same measured rectangle space as the anchor.
 * WKWebView may already pan getBoundingClientRect with the keyboard; CSS fixed
 * positioning still consumes layout coordinates, so keep visibleViewport raw.
 */
export function viewportRect(
  view = visibleViewport(),
  origin: { top: number; left: number } = document.body.getBoundingClientRect()
) {
  return {
    ...view,
    top: view.top + scrollY + origin.top,
    left: view.left + scrollX + origin.left,
    safeTop: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-safe-top')) || 0
  }
}

export function useVisibleViewport() {
  const [bounds, setBounds] = useState(visibleViewport)
  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const next = visibleViewport()
        setBounds((current) =>
          Object.keys(next).every(
            (key) => current[key as keyof typeof next] === next[key as keyof typeof next]
          )
            ? current
            : next
        )
      })
    }
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    update()
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [])
  return bounds
}
