import { useEffect, useRef } from 'react'

/**
 * 应用边缘导航补充；不申请系统手势排除区域，不接管内容区滚动或删除。
 * @param onBack - 与图标/系统返回相同的受保护返回入口。
 * @param onHome - 请求后台化；运行中的写入由调用方保护，草稿不清除。
 * @returns 无返回值；取消、失焦和卸载清理手势。
 */
export function useNavigationGestures(onBack: () => void, onHome: () => void) {
  const callbacks = useRef({ onBack, onHome })
  callbacks.current = { onBack, onHome }
  useEffect(() => {
    let gesture:
      | { zone: HTMLElement; kind: string; id: number; x: number; y: number; dx: number; dy: number }
      | undefined
    /** @returns 无返回值；取消不导航，也不保留活动反馈。 */
    function cancel() {
      gesture?.zone.classList.remove('active')
      gesture?.zone.style.removeProperty('--gesture-y')
      document.querySelectorAll<HTMLElement>('[data-navigation-zone]').forEach((zone) => {
        zone.classList.remove('active')
        zone.style.removeProperty('--gesture-y')
      })
      gesture = undefined
    }
    /** @param event - 单指从专用边缘条开始的触摸。 @returns 无返回值。 */
    function start(event: TouchEvent) {
      cancel()
      if (event.touches.length !== 1 || !(event.target instanceof Element)) return
      const zone = event.target.closest<HTMLElement>('[data-navigation-zone]')
      if (!zone) return
      const point = event.touches[0]!
      gesture = {
        zone,
        kind: zone.dataset.navigationZone!,
        id: point.identifier,
        x: point.clientX,
        y: point.clientY,
        dx: 0,
        dy: 0
      }
      zone.style.setProperty('--gesture-y', Math.max(70, Math.min(innerHeight - 130, point.clientY)) + 'px')
      event.preventDefault()
      event.stopPropagation()
    }
    /** @param event - 已接管的边缘触摸移动。 @returns 无返回值；多指立即取消。 */
    function move(event: TouchEvent) {
      if (!gesture) return
      if (event.touches.length !== 1) {
        cancel()
        return
      }
      const point = Array.from(event.touches).find((touch) => touch.identifier === gesture!.id)
      if (!point) {
        cancel()
        return
      }
      gesture.dx = point.clientX - gesture.x
      gesture.dy = point.clientY - gesture.y
      gesture.zone.classList.toggle('active', Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) > 12)
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
    }
    /** @returns 无返回值；只有明确的向内或向上位移才触发一次导航。 */
    function end() {
      const completed = gesture
      cancel()
      if (!completed) return
      const { kind, dx, dy } = completed
      if (kind === 'home') {
        if (dy < -64 && Math.abs(dx) < Math.abs(dy) * 0.6) callbacks.current.onHome()
      } else if (Math.abs(dy) < Math.abs(dx) * 0.6 && (kind === 'left' ? dx > 56 : dx < -56)) {
        callbacks.current.onBack()
      }
    }
    const visibility = () => {
      if (document.hidden) cancel()
    }
    window.addEventListener('touchstart', start, { capture: true, passive: false })
    window.addEventListener('touchmove', move, { capture: true, passive: false })
    window.addEventListener('touchend', end, true)
    window.addEventListener('touchcancel', cancel, true)
    window.addEventListener('blur', cancel)
    window.addEventListener('pagehide', cancel)
    window.addEventListener('resize', cancel)
    window.addEventListener('pageshow', cancel)
    window.addEventListener('logbook-gesture-reset', cancel)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      cancel()
      window.removeEventListener('touchstart', start, true)
      window.removeEventListener('touchmove', move, true)
      window.removeEventListener('touchend', end, true)
      window.removeEventListener('touchcancel', cancel, true)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pagehide', cancel)
      window.removeEventListener('resize', cancel)
      window.removeEventListener('pageshow', cancel)
      window.removeEventListener('logbook-gesture-reset', cancel)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
}
