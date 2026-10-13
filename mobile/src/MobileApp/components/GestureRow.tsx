import { useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GestureTestingContext } from './GestureTestingContext'

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
  const context = useContext(GestureTestingContext)
  const testing = process.env.NODE_ENV === 'development' ? context : undefined
  const testingRef = useRef(testing)
  testingRef.current = testing
  const active = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const cleanup = useRef<() => void>(() => {})
  const suppressClick = useRef(0)
  const [reveal, setReveal] = useState(false)
  const [motion, setMotion] = useState({ x: 0, y: 0, mode: '' })
  useEffect(
    () => () => {
      cleanup.current()
      if (testingRef.current?.source?.id === latest.current.id) testingRef.current.cancel()
    },
    []
  )

  function begin(
    x: number,
    y: number,
    input: 'touch' | 'mouse' | 'pointer',
    target: EventTarget | null,
    pointerId?: number
  ) {
    if (
      props.disabled ||
      !(target instanceof Element) ||
      target.closest('input, select, textarea, [data-no-gesture], .swipe-delete')
    )
      return
    cleanup.current()
    active.current = true
    function capture() {
      if (pointerId !== undefined) {
        try {
          root.current?.setPointerCapture(pointerId)
        } catch {
          /* Window listeners remain available. */
        }
      }
    }
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
      capture()
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
      const tolerance = input === 'touch' ? 9 : 14
      if (!mode && Math.abs(deltaX) > tolerance && Math.abs(deltaX) > Math.abs(deltaY) * 1.25 && deltaX < 0) {
        clearTimeout(timer)
        mode = 'swipe'
        capture()
      } else if (!armed && !mode && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > tolerance) {
        finish(true)
        return
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
    const pointerMove = (event: PointerEvent) => {
      if (event.pointerId === pointerId) move(event.clientX, event.clientY, event)
    }
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
    const pointerEnd = (event: PointerEvent) => {
      if (event.pointerId === pointerId) finish()
    }
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) finish(true)
    }
    if (input === 'touch') {
      window.addEventListener('touchmove', touchMove, { passive: false })
      window.addEventListener('touchend', end)
      window.addEventListener('touchcancel', cancel)
    } else if (input === 'pointer') {
      window.addEventListener('pointermove', pointerMove, { passive: false })
      window.addEventListener('pointerup', pointerEnd)
      window.addEventListener('pointercancel', pointerCancel)
    } else {
      window.addEventListener('mousemove', mouseMove)
      window.addEventListener('mouseup', end)
    }
    window.addEventListener('blur', cancel)
    cleanup.current = () => {
      active.current = false
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', cancel)
      window.removeEventListener('mousemove', mouseMove)
      window.removeEventListener('mouseup', end)
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerEnd)
      window.removeEventListener('pointercancel', pointerCancel)
      if (pointerId !== undefined && root.current?.hasPointerCapture(pointerId))
        root.current.releasePointerCapture(pointerId)
      window.removeEventListener('blur', cancel)
      unmark()
      cleanup.current = () => {}
    }
  }
  return (
    <div
      ref={root}
      className={
        'gesture-row ' +
        motion.mode +
        (reveal ? ' revealed' : '') +
        (testing?.source?.id === props.id ? ' held' : '')
      }
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
        begin(point.clientX, point.clientY, 'touch', event.target)
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'touch' || event.button !== 0) return
        event.stopPropagation()
        begin(event.clientX, event.clientY, 'pointer', event.target, event.pointerId)
      }}
      onMouseDown={(event) => {
        if (event.button !== 0 || active.current) return
        if ((event.target as Element).closest('input, select, textarea, [data-no-gesture], .swipe-delete'))
          return
        event.stopPropagation()
        event.preventDefault()
        begin(event.clientX, event.clientY, 'mouse', event.target)
      }}
      onDragStart={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setReveal(false)
        if (event.key === 'Delete' && !props.disabled) {
          event.preventDefault()
          setReveal(true)
        }
      }}
      onClickCapture={(event) => {
        if ((event.target as Element).closest('.swipe-delete, [data-no-gesture], input')) return
        if (
          testing?.enabled &&
          testing.source &&
          props.group === testing.source.group &&
          props.id !== testing.source.id
        ) {
          event.preventDefault()
          event.stopPropagation()
          const source = testing.source
          testing.cancel()
          source.drop(props.id)
          return
        }
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
      {process.env.NODE_ENV === 'development' && testing?.enabled && (
        <div className="gesture-testing-tools" data-no-gesture>
          {props.onHold && (
            <button type="button" disabled={props.disabled} onClick={props.onHold}>
              模拟长按
            </button>
          )}
          <button type="button" disabled={props.disabled} onClick={() => setReveal(true)}>
            模拟左滑
          </button>
          {props.onReorder && props.group && (
            <button
              type="button"
              disabled={props.disabled}
              onClick={() =>
                testing.start({
                  id: props.id,
                  group: props.group!,
                  label: props.label,
                  drop: (targetId) => latest.current.onReorder?.(targetId)
                })
              }
            >
              模拟拖动
            </button>
          )}
        </div>
      )}
    </div>
  )
}
