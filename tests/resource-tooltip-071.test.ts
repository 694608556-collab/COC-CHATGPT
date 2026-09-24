/**
 * 0.7.1 阶段 4：资料卡片的悬停提示要用应用自己的样式。
 *
 * 用户反馈「鼠标悬停资料图标时，提示的窗口样式要和应用风格一致」。
 * 此前用的是 HTML 原生 title 属性，浏览器渲染成系统默认的黑底黄字方块，
 * 与应用风格完全不搭。
 *
 * 做法：改用自绘的浮层（.app-tooltip），由 data-tip 属性驱动，
 * 卡片上的图标与资料名都不再使用 title。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.7.1 stage 4: application-styled hover tooltips', () => {
  it('no longer relies on the native title attribute for card actions', () => {
    const page = read('src/renderer/src/components/ResourcesPage.tsx')
    // 卡片区域的三个/四个图标与资料名都不该再用 title（那是系统原生提示）
    const cardBlock = page.slice(page.indexOf('const renderCard'), page.indexOf('const renderGroup'))
    expect(cardBlock).not.toContain('title="更新（重新指定这个资料对应的文件）"')
    expect(cardBlock).not.toContain('title="用原程序打开"')
    expect(cardBlock).not.toContain('title="从汇总里移除（不删除原文件）"')
    // 改用 data-tip
    expect(cardBlock).toContain('data-tip')
  })

  it('defines an app-styled tooltip in the stylesheet', () => {
    const styles = read('src/renderer/src/styles.css')
    // 由 data-tip 驱动、::after 自绘，样式与应用同一套（深色底、圆角、12px）
    expect(styles).toContain('[data-tip]:hover::after')
    expect(styles).toContain('content: attr(data-tip)')
    expect(styles).toContain('border-radius')
    // 只认 data-tip 属性，不额外要求 class，避免「忘了加 class 提示就不出现」
    expect(styles).not.toContain('.has-tip')
  })

  it('anchors the tooltip to the left edge so it can never be clipped', () => {
    const styles = read('src/renderer/src/styles.css')
    const block = styles.slice(styles.indexOf('[data-tip]:hover::after'))
    const rule = block.slice(0, block.indexOf('}'))
    // 贴在元素左边缘向右展开。此前用 left:50% + translateX(-50%) 居中，
    // 元素靠近窗口左侧时提示会有一半跑到窗口外，首几个字被裁掉（实测过）。
    expect(rule).toContain('left: 0')
    expect(rule).not.toContain('translateX(-50%)')
    // 上限要足够放下最长的一条提示，避免折行后看不全
    expect(rule).toContain('max-width: 320px')
  })

  it('does not show the card tooltip while an icon inside it is hovered', () => {
    const styles = read('src/renderer/src/styles.css')
    // 图标在卡片 DOM 内，卡片的 :hover 也成立，两个提示会叠在一起
    expect(styles).toContain('.resource-tile[data-tip]:has(.resource-tile-actions :hover)::after')
    expect(styles).toContain('content: none')
  })

  it('renders the tooltip through a shared component so every icon looks the same', () => {
    const files = fs.readdirSync(path.join(root, 'src/renderer/src/components'))
    const hasComponent = files.some((file) => file.toLowerCase().includes('tooltip'))
    expect(hasComponent).toBe(true)
  })

  it('keeps the tooltip off screen readers duplication by using aria-label', () => {
    const page = read('src/renderer/src/components/ResourcesPage.tsx')
    // 视觉提示走 data-tip，无障碍名称仍走 aria-label，两者不冲突
    expect(page).toContain('aria-label')
  })
})
