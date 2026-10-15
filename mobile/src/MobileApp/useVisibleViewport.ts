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
