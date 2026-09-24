/**
 * 应用风格的自绘提示浮层。
 *
 * 为什么不用 HTML 原生 title：浏览器会把它渲染成系统默认的黑底方块，
 * 字体、圆角、间距都和应用不一致，用户看到的就是「提示窗口样式不搭」。
 *
 * 做法：把提示文字放进 data-tip，由 styles.css 里的 `[data-tip]:hover::after`
 * 画出来。纯 CSS 实现的好处是不需要计算定位，图标挤在卡片右上角时也不会
 * 出现浮层跟着鼠标乱飘或超出窗口的问题。
 *
 * 无障碍：视觉提示走 data-tip，读屏名称仍由调用方通过 aria-label 提供，
 * 两者互不干扰（原生 title 会同时充当这两者，所以才不好替换）。
 */
import type { ReactNode } from 'react'

/** 带提示的浮层属性；展开到任意元素上即可获得应用风格的悬停提示 */
export function tipProps(text: string): Record<string, string> {
  return { 'data-tip': text }
}

/**
 * 把提示挂到一个元素上。
 *
 * 用 span 包一层是为了不改变原有元素的语义（按钮仍是按钮），
 * 同时让提示的定位锚点稳定。
 */
export function AppTooltip({
  text,
  children
}: {
  text: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <span data-tip={text} style={{ display: 'inline-flex' }}>
      {children}
    </span>
  )
}
