// 0.7.7 修复：导图画布的缩放锚点与拖动行为
//
// 问题 1：Ctrl+滚轮快速缩放时画面突跳
//   0.7.6 在 setZoom 的更新函数里各自排一个 requestAnimationFrame，快速滚动时
//   好几个 wheel 事件在 React 重渲染前接连触发，每个都按**旧的** scrollWidth
//   算比例、又各自排一个 rAF，随后依次执行、互相覆盖，用的还是过期比例。
//
// 问题 2：长按左键拖动时变成框选文字、画布乱晃
//   mousedown 没有 preventDefault，浏览器同时启动了原生文字选择；且鼠标移出
//   窗口后收不到 move/up，拖拽卡住。
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const viewer = fs.readFileSync(
  new URL('../src/renderer/src/components/MindmapViewer.tsx', import.meta.url),
  'utf8'
)
const styles = fs.readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')

describe('0.7.7 zoom keeps the point under the cursor', () => {
  it('records the anchor in a ref instead of inside the state updater', () => {
    // 锚点必须记在 ref 里，由缩放落地后的 useLayoutEffect 统一消费
    expect(viewer).toContain('const pendingAnchor = useRef<')
    expect(viewer).toContain('pendingAnchor.current = {')
    // 不能在 setZoom 的更新函数里做副作用（更新函数可能被调用多次）
    const updater = /setZoom\(\(value\) => \{([\s\S]*?)\n {6}\}\)/.exec(viewer)?.[1] ?? ''
    expect(updater, 'setZoom 的更新函数里不应有 requestAnimationFrame').not.toContain(
      'requestAnimationFrame'
    )
    expect(updater, 'setZoom 的更新函数里不应写滚动位置').not.toContain('scrollLeft')
  })

  it('applies the anchor in useLayoutEffect so there is no flash or jump', () => {
    // useLayoutEffect 在 React 写完 DOM 之后、浏览器绘制之前同步执行：
    // 读到的尺寸已是新值，且校正发生在绘制前，不会闪
    expect(viewer).toContain('useLayoutEffect(() => {')
    expect(viewer).toMatch(/body\.scrollLeft = anchor\.ratioX \* body\.scrollWidth - anchor\.offsetX/)
    expect(viewer).toMatch(/body\.scrollTop = anchor\.ratioY \* body\.scrollHeight - anchor\.offsetY/)
    // 消费后必须清掉，否则后续无关的重渲染会重复套用同一个锚点
    expect(viewer).toContain('pendingAnchor.current = undefined')
  })

  it('does not schedule a requestAnimationFrame per wheel event', () => {
    // 0.7.6 的写法：每个 wheel 事件各排一个 rAF，快速滚动时会互相覆盖。
    // 只看 setZoom 那一次调用本身（到配对的 `})` 为止），不要跨语句匹配
    const call = /setZoom\(\(value\) => \{[\s\S]{0,400}?\n {6}\}\)/.exec(viewer)?.[0] ?? ''
    expect(call, '应能找到 setZoom 的更新函数').toContain('Math.min(8')
    expect(call, '更新函数里不应排 rAF').not.toContain('requestAnimationFrame')
    // 整个滚轮处理器里也不该再出现 rAF
    expect(viewer).not.toContain('window.requestAnimationFrame')
  })

  it('keeps the zoom clamped and the wheel non-passive', () => {
    // 缩放范围与拦截原生滚动这两条不能因为改锚点而丢掉
    expect(viewer).toContain('Math.min(8, Math.max(0.15, value * factor))')
    expect(viewer).toContain("body.addEventListener('wheel', onWheel, { passive: false })")
  })
})

describe('0.7.7 dragging the canvas never selects text', () => {
  it('prevents the native selection on pointer down', () => {
    // 不加 preventDefault，拖动就会变成拉选文字
    const down = /const onPointerDown = \(event: React\.PointerEvent<HTMLDivElement>\): void => \{([\s\S]*?)\n {2}\}/.exec(
      viewer
    )?.[1]
    expect(down, '应能找到 onPointerDown').toBeDefined()
    expect(down!).toContain('event.preventDefault()')
    expect(down!).toContain('setPointerCapture(event.pointerId)')
  })

  it('captures the pointer so dragging keeps working outside the window', () => {
    // 指针移出窗口后 mousemove/mouseup 收不到，拖拽会卡住；
    // 用 setPointerCapture 把事件锁在这个元素上
    expect(viewer).toContain('body.setPointerCapture(event.pointerId)')
    expect(viewer).toContain('body.releasePointerCapture(start.pointerId)')
    expect(viewer).toContain('onPointerUp={endPan}')
    expect(viewer).toContain('onPointerCancel={endPan}')
    // 不再用会在移出窗口时丢事件的 Mouse Events
    expect(viewer).not.toContain('onMouseDown={onMouseDown}')
    expect(viewer).not.toContain('onMouseLeave={endPan}')
  })

  it('ignores move events from a different pointer', () => {
    // 多指/多设备时，只有发起拖拽的那个 pointerId 才该移动画布
    expect(viewer).toContain('start.pointerId !== event.pointerId')
  })

  it('forbids text selection on the canvas in CSS as a second guard', () => {
    // 只靠 JS 的 preventDefault 不够：指针移动过程中浏览器仍可能发起选择
    const body = /\.mindmap-viewer-body \{([\s\S]*?)\n\}/.exec(styles)?.[1] ?? ''
    expect(body).toContain('user-select: none')
  })
})
