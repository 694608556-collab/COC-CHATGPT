import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** Touch and mouse share one gesture state; ordinary vertical movement remains page scrolling. */
export function GestureRow(props: {
  id: string
  group?: string
  label: string
  disabled?: boolean
  onDelete(): void
  onHold?(): void
  onReorder?(targetId: string): void
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const cleanup = useRef<() => void>(() => {})
  const suppressClick = useRef(0)
  const [reveal, setReveal] = useState(false)
  const [motion, setMotion] = useState({ x: 0, y: 0, mode: '' })
  useEffect(() => () => cleanup.current(), [])

  function begin(x: number, y: number, touch: boolean, target: EventTarget | null) {
    if (
      props.disabled ||
      !(target instanceof Element) ||
      target.closest('input, select, textarea, [data-no-gesture], .swipe-delete')
    )
      return
    cleanup.current()
    const start = { x, y }
    const startScrollY = window.scrollY
    let armed = false
    let mode = ''
    let deltaX = 0
    let deltaY = 0
    let drop: HTMLElement | undefined
    let lastY = y
    let frame = 0
    const timer = window.setTimeout(() => {
      armed = true
      setMotion({ x: 0, y: 0, mode: 'held' })
    }, 480)
    const unmark = () => {
      drop?.classList.remove('drop-target')
      drop = undefined
    }
    function updateDrop() {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-drag-id]')).filter(
        (node) => node.dataset.dragGroup === latest.current.group && node.dataset.dragId !== latest.current.id
      )
      const within = nodes.find((node) => {
        const box = node.getBoundingClientRect()
        return lastY >= box.top && lastY <= box.bottom
      })
      if (within === drop) return
      unmark()
      if (within) {
        drop = within
        drop.classList.add('drop-target')
      }
    }
    function scrollDuringDrag() {
      const distance = lastY > innerHeight - 110 ? 10 : lastY < 70 ? -10 : 0
      if (distance) {
        window.scrollBy(0, distance)
        setMotion({ x: 0, y: deltaY + window.scrollY - startScrollY, mode: 'drag' })
        updateDrop()
      }
      frame = requestAnimationFrame(scrollDuringDrag)
    }
    function move(nextX: number, nextY: number, event: Event) {
      lastY = nextY
      deltaX = nextX - start.x
      deltaY = nextY - start.y
      if (!armed && !mode && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 9) {
        clearTimeout(timer)
        if (Math.abs(deltaX) > Math.abs(deltaY) * 1.25 && deltaX < 0) mode = 'swipe'
        else {
          finish(true)
          return
        }
      }
      if (armed && !mode && Math.abs(deltaY) > 8 && latest.current.onReorder) {
        mode = 'drag'
        frame = requestAnimationFrame(scrollDuringDrag)
      }
      if ((armed || mode) && event.cancelable) event.preventDefault()
      if (mode === 'swipe') setMotion({ x: Math.max(-80, Math.min(0, deltaX)), y: 0, mode })
      if (mode === 'drag') {
        setReveal(false)
        setMotion({ x: 0, y: deltaY + window.scrollY - startScrollY, mode })
        updateDrop()
      }
    }
    function finish(cancelled = false) {
      clearTimeout(timer)
      const targetId = drop?.dataset.dragId
      cleanup.current()
      setMotion({ x: 0, y: 0, mode: '' })
      if (cancelled) return
      if (mode || armed) suppressClick.current = Date.now() + 450
      if (mode === 'swipe') setReveal(deltaX < -35)
      else if (mode === 'drag' && targetId) latest.current.onReorder?.(targetId)
      else if (armed && !mode) latest.current.onHold?.()
    }
    const mouseMove = (event: MouseEvent) => move(event.clientX, event.clientY, event)
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        finish(true)
        return
      }
      const point = event.touches[0]!
      move(point.clientX, point.clientY, event)
    }
    const end = () => finish()
    const cancel = () => finish(true)
    if (touch) {
      window.addEventListener('touchmove', touchMove, { passive: false })
      window.addEventListener('touchend', end)
      window.addEventListener('touchcancel', cancel)
    } else {
      window.addEventListener('mousemove', mouseMove)
      window.addEventListener('mouseup', end)
    }
    window.addEventListener('blur', cancel)
    cleanup.current = () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', cancel)
      window.removeEventListener('mousemove', mouseMove)
      window.removeEventListener('mouseup', end)
      window.removeEventListener('blur', cancel)
      unmark()
      cleanup.current = () => {}
    }
  }
  return (
    <div
      ref={root}
      className={'gesture-row ' + motion.mode + (reveal ? ' revealed' : '')}
      data-drag-id={props.id}
      data-drag-group={props.group}
      onTouchStart={(event) => {
        if (event.touches.length !== 1) {
          cleanup.current()
          setMotion({ x: 0, y: 0, mode: '' })
          return
        }
        event.stopPropagation()
        const point = event.touches[0]!
        begin(point.clientX, point.clientY, true, event.target)
      }}
      onMouseDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        begin(event.clientX, event.clientY, false, event.target)
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setReveal(false)
        if (event.key === 'Delete' && !props.disabled) {
          event.preventDefault()
          setReveal(true)
        }
      }}
      onClickCapture={(event) => {
        if ((event.target as Element).closest('.swipe-delete')) return
        if (Date.now() < suppressClick.current) {
          event.preventDefault()
          event.stopPropagation()
        } else if (reveal) {
          event.preventDefault()
          event.stopPropagation()
          setReveal(false)
        }
      }}
    >
      <button
        type="button"
        className="swipe-delete"
        tabIndex={reveal ? 0 : -1}
        aria-hidden={!reveal}
        aria-label={'删除' + props.label}
        disabled={props.disabled || !reveal}
        onClick={() => {
          setReveal(false)
          props.onDelete()
        }}
      >
        删除
      </button>
      <div
        className="gesture-content"
        style={{
          transform: `translate(${motion.mode === 'swipe' ? motion.x : reveal ? -80 : 0}px, ${motion.y}px)`
        }}
      >
        {props.children}
      </div>
    </div>
  )
}
