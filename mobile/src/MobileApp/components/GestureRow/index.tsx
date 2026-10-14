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
  useEffect(() => {
    const reset = () => {
      if (active.current) suppressClick.current = Date.now() + 450
      cleanup.current()
      setVisualMode('')
      setReveal(false)
      testingRef.current?.cancel()
    }
    const visibility = () => {
      if (document.hidden) reset()
    }
    window.addEventListener('logbook-gesture-reset', reset)
    window.addEventListener('pagehide', reset)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      reset()
      window.removeEventListener('logbook-gesture-reset', reset)
      window.removeEventListener('pagehide', reset)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])

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
    let targetId: string | undefined
    let finished = false
    let lastY = y
    let paintFrame = 0
    let swipeOffset = 0
    let targets: Array<{
      node: HTMLElement
      id: string
      top: number
      height: number
      center: number
      gap: number
    }> = []
    let sourceIndex = -1
    let previewIndex = -1
    let sourceNode: HTMLElement | undefined
    const owner = root.current
    /** @returns 无返回值；每帧统一滚动、目标标记和位移，移动事件不再反复改样式。 */
    function paint() {
      paintFrame = 0
      const distance = mode === 'drag' ? (lastY > innerHeight - 110 ? 10 : lastY < 70 ? -10 : 0) : 0
      if (distance) window.scrollBy(0, distance)
      const scroll = window.scrollY
      if (mode === 'drag') {
        updateDrop(deltaY + scroll - startScrollY)
        if (sourceNode) sourceNode.style.transform = `translate3d(0, ${deltaY + scroll - startScrollY}px, 0)`
      } else if (content) content.style.transform = `translate3d(${swipeOffset}px, 0, 0)`
      if (distance) paintFrame = requestAnimationFrame(paint)
    }
    /** @returns 无返回值；合并当前手势位移到下一绘制帧。 */
    function schedulePaint() {
      swipeOffset = mode === 'swipe' ? Math.max(-56, Math.min(0, (reveal ? -56 : 0) + deltaX)) : 0
      if (!paintFrame) paintFrame = requestAnimationFrame(paint)
    }
    const timer = fromHandle
      ? 0
      : window.setTimeout(() => {
          armed = true
          capture()
          setVisualMode('held')
        }, 480)
    /** @returns 无返回值；读取一次未变形的目标位置，不在移动事件中强制全列表布局。 */
    function captureTargets() {
      targets = Array.from(document.querySelectorAll<HTMLElement>('[data-drag-id]'))
        .filter((node) => node.dataset.dragGroup === latest.current.group)
        .map((row) => {
          const node = latest.current.group === 'modules' ? row.closest<HTMLElement>('.module-group')! : row
          const box = node.getBoundingClientRect()
          const handleBox = row.getBoundingClientRect()
          return {
            node,
            id: row.dataset.dragId!,
            top: box.top + window.scrollY,
            height: box.height,
            center: handleBox.top + window.scrollY + handleBox.height / 2,
            gap: 0
          }
        })
      targets.forEach((item, index) => {
        item.gap = Math.max(
          0,
          (targets[index + 1]?.top ?? item.top + item.height + 8) - item.top - item.height
        )
      })
      sourceIndex = targets.findIndex((item) => item.id === latest.current.id)
      sourceNode = targets[sourceIndex]?.node
      sourceNode?.classList.add('drag-source')
      if (sourceNode) {
        sourceNode.style.willChange = 'transform'
        sourceNode.style.transition = 'none'
      }
    }
    /** @param offset - 源行相对原位置的纵向位移。 @returns 无返回值；只预览让位，不写入数据。 */
    function updateDrop(offset: number) {
      const source = targets[sourceIndex]
      if (!source) return
      const center = source.center + offset
      let index = sourceIndex
      let closest = Infinity
      targets.forEach((item, candidate) => {
        const distance = Math.abs(center - item.center)
        if (distance < closest) {
          closest = distance
          index = candidate
        }
      })
      targetId = index === sourceIndex ? undefined : targets[index]!.id
      if (index === previewIndex) return
      previewIndex = index
      const order = targets.slice()
      order.splice(sourceIndex, 1)
      order.splice(index, 0, source)
      let top = targets[0]!.top
      order.forEach((item) => {
        if (item !== source) {
          const offset = top - item.top
          if (Math.abs(offset) > 0.5) {
            item.node.style.transition = 'transform 120ms ease-out'
            item.node.style.transform = `translate3d(0, ${offset}px, 0)`
            item.node.dataset.dragPreview = 'true'
          } else {
            item.node.style.removeProperty('transform')
            item.node.style.removeProperty('transition')
            delete item.node.dataset.dragPreview
          }
        }
        top += item.height + item.gap
      })
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
        schedulePaint()
      }
    }
    /**
     * 收尾并最多提交一个选择/排序操作，取消不提交。
     * @param cancelled - 是否由取消、失焦等中断触发。
     * @returns 无返回值。
     */
    function finish(cancelled = false) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      // 松手可能早于已排队的绘制帧；使用最新触摸位置决定目标，不丢失最后一段移动。
      if (mode === 'drag' && !cancelled) updateDrop(deltaY + window.scrollY - startScrollY)
      cleanup.current()
      setVisualMode('')
      if (mode || armed) suppressClick.current = Date.now() + 450
      if (cancelled) return
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
    const lostCapture = (event: PointerEvent) => {
      // 触屏子元素的隐式捕获会先于 touchend 释放；只有本行主动捕获丢失才取消。
      if (pointerId !== undefined && event.pointerId === pointerId && event.target === owner) finish(true)
    }
    const extraTouch = (event: TouchEvent) => {
      if (event.touches.length !== 1) finish(true)
    }
    const visibility = () => {
      if (document.hidden) finish(true)
    }
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
    window.addEventListener('touchstart', extraTouch)
    window.addEventListener('pagehide', cancel)
    window.addEventListener('resize', cancel)
    document.addEventListener('visibilitychange', visibility)
    owner?.addEventListener('lostpointercapture', lostCapture)
    cleanup.current = () => {
      active.current = false
      clearTimeout(timer)
      cancelAnimationFrame(paintFrame)
      // React only owns gesture classes; always release the imperative transform on every exit.
      content?.style.removeProperty('transform')
      owner?.classList.remove('drag', 'swipe', 'held')
      targets.forEach(({ node }) => {
        node.style.removeProperty('transform')
        node.style.removeProperty('transition')
        node.style.removeProperty('will-change')
        node.classList.remove('drag-source', 'drop-target')
        delete node.dataset.dragPreview
      })
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', cancel)
      window.removeEventListener('mousemove', mouseMove)
      window.removeEventListener('mouseup', end)
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerEnd)
      window.removeEventListener('pointercancel', pointerCancel)
      owner?.removeEventListener('lostpointercapture', lostCapture)
      if (pointerId !== undefined && owner?.hasPointerCapture(pointerId))
        owner.releasePointerCapture(pointerId)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('touchstart', extraTouch)
      window.removeEventListener('pagehide', cancel)
      window.removeEventListener('resize', cancel)
      document.removeEventListener('visibilitychange', visibility)
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
