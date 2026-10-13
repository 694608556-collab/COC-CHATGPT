import { useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GestureTestingContext } from '../GestureTestingContext'

/** 同一列表行的手势契约；忙状态只禁止写入，不禁止查看删除入口或多选。 */
interface GestureRowProps {
  /** 实体标识，类型为 string。 */
  id: string
  /** 同一排序列表的分组标识，类型为 string | undefined。 */
  group?: string
  /** 删除入口的可访问名称，类型为 string。 */
  label: string
  /** 是否禁止删除/排序提交，类型为 boolean | undefined。 */
  disabled?: boolean
  /** 请求确认删除，不直接删除；类型为无参数回调。 */
  onDelete(): void
  /** 长按松开的只读选择回调，可不提供。 */
  onHold?(): void
  /** 松开拖动时请求排序，参数为同组目标标识；可不提供。 */
  onReorder?(targetId: string): void
  /** 列表行可见内容，类型为 ReactNode。 */
  children: ReactNode
}

/**
 * 统一触屏/鼠标列表手势，仅在拖动期间缓存目标几何信息。
 * @param props - 列表身份、忙状态与确认删除/长按/排序回调。
 * @returns 可左滑露出灰色删除入口的列表行；普通纵向移动仍滚动页面。
 */
export function GestureRow(props: GestureRowProps) {
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
  const [visualMode, setVisualMode] = useState('')
  const beginRef = useRef(begin)
  beginRef.current = begin
  useEffect(() => {
    const handle = root.current?.querySelector<HTMLElement>('.drag-handle')
    if (!handle) return
    /** @param event - 手柄的原生触摸起点。 @returns 无返回值；仅专用手柄接管页面滚动。 */
    function startHandle(event: TouchEvent) {
      if (event.touches.length !== 1 || latest.current.disabled) return
      event.preventDefault()
      event.stopPropagation()
      const point = event.touches[0]!
      beginRef.current(point.clientX, point.clientY, 'touch', event.target)
    }
    // React 的触摸监听可能为 passive；专用手柄必须在起点就阻止原生滚动。
    handle.addEventListener('touchstart', startHandle, { passive: false })
    return () => handle.removeEventListener('touchstart', startHandle)
  }, [!!props.onReorder])
  useEffect(
    () => () => {
      cleanup.current()
      if (testingRef.current?.source?.id === latest.current.id) testingRef.current.cancel()
    },
    []
  )

  /**
   * 启动单次手势，松开或取消时移除监听和动画帧。
   * @param x - 起始视口横坐标，CSS px。
   * @param y - 起始视口纵坐标，CSS px。
   * @param input - 输入来源；触屏保留普通滚动。
   * @param target - 事件目标，表单及删除入口不启动手势。
   * @param pointerId - 鼠标指针捕获标识，触屏可不提供。
   * @returns 无返回值。
   */
  function begin(
    x: number,
    y: number,
    input: 'touch' | 'mouse' | 'pointer',
    target: EventTarget | null,
    pointerId?: number
  ) {
    if (
      !(target instanceof Element) ||
      target.closest('input, select, textarea, [data-no-gesture], .swipe-delete')
    )
      return
    cleanup.current()
    const fromHandle = !!target.closest('.drag-handle')
    if (fromHandle && (latest.current.disabled || !latest.current.onReorder)) return
    active.current = true
    const content = root.current?.querySelector<HTMLElement>('.gesture-content')
    /** @returns 无返回值；在手势明确开始时捕获鼠标指针，触屏不提前截断滚动。 */
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
    let armed = fromHandle
    let mode = fromHandle ? 'drag' : ''
    let deltaX = 0
    let deltaY = 0
    let drop: HTMLElement | undefined
    let lastY = y
    let paintFrame = 0
    let pendingMotion = { x: 0, y: 0, mode: '' }
    let targets: Array<{ node: HTMLElement; top: number; bottom: number }> = []
    /** @returns 无返回值；每帧统一滚动、目标标记和位移，移动事件不再反复改样式。 */
    function paint() {
      paintFrame = 0
      const distance = mode === 'drag' ? (lastY > innerHeight - 110 ? 10 : lastY < 70 ? -10 : 0) : 0
      if (distance) window.scrollBy(0, distance)
      const scroll = window.scrollY
      if (mode === 'drag') updateDrop(lastY + scroll)
      if (content)
        content.style.transform = `translate3d(${pendingMotion.x}px, ${mode === 'drag' ? deltaY + scroll - startScrollY : 0}px, 0)`
      if (distance) paintFrame = requestAnimationFrame(paint)
    }
    /** @returns 无返回值；合并当前手势位移到下一绘制帧。 */
    function schedulePaint() {
      pendingMotion = {
        x: mode === 'swipe' ? Math.max(-56, Math.min(0, (reveal ? -56 : 0) + deltaX)) : 0,
        y: mode === 'drag' ? deltaY + window.scrollY - startScrollY : 0,
        mode
      }
      if (!paintFrame) paintFrame = requestAnimationFrame(paint)
    }
    const timer = fromHandle
      ? 0
      : window.setTimeout(() => {
          armed = true
          capture()
          setVisualMode('held')
        }, 480)
    /** @returns 无返回值；清理上一个目标的视觉标记。 */
    const unmark = () => {
      drop?.classList.remove('drop-target')
      drop = undefined
    }
    /** @returns 无返回值；读取一次未变形的目标位置，不在移动事件中强制全列表布局。 */
    function captureTargets() {
      targets = Array.from(document.querySelectorAll<HTMLElement>('[data-drag-id]'))
        .filter(
          (node) =>
            node.dataset.dragGroup === latest.current.group && node.dataset.dragId !== latest.current.id
        )
        .map((node) => {
          const box = node.getBoundingClientRect()
          return { node, top: box.top + window.scrollY, bottom: box.bottom + window.scrollY }
        })
    }
    /** @param position - 手指的文档纵坐标，CSS px。 @returns 无返回值；滚动不会使缓存失效。 */
    function updateDrop(position: number) {
      const within = targets.find((item) => position >= item.top && position <= item.bottom)?.node
      if (within === drop) return
      unmark()
      if (within) {
        drop = within
        drop.classList.add('drop-target')
      }
    }
    /**
     * 分类横滑/拖动；普通纵向滚动不提交业务操作。
     * @param nextX - 当前视口横坐标，CSS px。
     * @param nextY - 当前视口纵坐标，CSS px。
     * @param event - 可取消的输入事件。
     * @returns 无返回值。
     */
    function move(nextX: number, nextY: number, event: Event) {
      lastY = nextY
      deltaX = nextX - start.x
      deltaY = nextY - start.y
      const tolerance = input === 'touch' ? 9 : 14
      if (
        !mode &&
        Math.abs(deltaX) > tolerance &&
        Math.abs(deltaX) > Math.abs(deltaY) * 1.25 &&
        (deltaX < 0 || (reveal && deltaX > 0))
      ) {
        clearTimeout(timer)
        mode = 'swipe'
        setVisualMode(mode)
        capture()
      } else if (!armed && !mode && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > tolerance) {
        finish(true)
        return
      }
      if (armed && !mode && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > tolerance) {
        // 卡片正文长按仅用于多选；继续移动则取消选择，不偷偷切换为排序。
        finish(true)
        return
      }
      if ((armed || mode) && event.cancelable) event.preventDefault()
      if (mode === 'swipe') schedulePaint()
      if (mode === 'drag') {
        setReveal(false)
        schedulePaint()
      }
    }
    /**
     * 收尾并最多提交一个选择/排序操作，取消不提交。
     * @param cancelled - 是否由取消、失焦等中断触发。
     * @returns 无返回值。
     */
    function finish(cancelled = false) {
      clearTimeout(timer)
      // 松手可能早于已排队的绘制帧；使用最新触摸位置决定目标，不丢失最后一段移动。
      if (mode === 'drag' && !cancelled) updateDrop(lastY + window.scrollY)
      const targetId = drop?.dataset.dragId
      cleanup.current()
      setVisualMode('')
      if (cancelled) return
      if (mode || armed) suppressClick.current = Date.now() + 450
      if (mode === 'swipe') setReveal((reveal ? -56 : 0) + deltaX < -28)
      else if (mode === 'drag' && targetId && !latest.current.disabled) latest.current.onReorder?.(targetId)
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
      cancelAnimationFrame(paintFrame)
      // React only owns gesture classes; always release the imperative transform on every exit.
      content?.style.removeProperty('transform')
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
    if (fromHandle) {
      capture()
      captureTargets()
      setReveal(false)
      setVisualMode('drag')
    }
  }
  return (
    <div
      ref={root}
      className={
        'gesture-row ' +
        visualMode +
        (reveal ? ' revealed' : '') +
        (testing?.source?.id === props.id ? ' held' : '')
      }
      data-drag-id={props.id}
      data-drag-group={props.group}
      onTouchStart={(event) => {
        if ((event.target as Element).closest('.drag-handle')) return
        if (event.touches.length !== 1) {
          cleanup.current()
          setVisualMode('')
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
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M6 18L18 6" />
        </svg>
      </button>
      <div className="gesture-content">
        <div className="gesture-main">{props.children}</div>
        {props.onReorder && (
          <button
            type="button"
            className="drag-handle"
            aria-label={'拖动排序' + props.label}
            title="从这里拖动排序"
            disabled={props.disabled}
            onClick={(event) => event.preventDefault()}
          >
            <svg width="18" height="20" viewBox="0 0 18 20" fill="currentColor" aria-hidden="true">
              <circle cx="6" cy="5" r="1.5" />
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="6" cy="10" r="1.5" />
              <circle cx="12" cy="10" r="1.5" />
              <circle cx="6" cy="15" r="1.5" />
              <circle cx="12" cy="15" r="1.5" />
            </svg>
          </button>
        )}
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
