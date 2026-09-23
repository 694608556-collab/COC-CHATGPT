import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.6.7 Windows 10 caption buttons', () => {
  const app = read('src/renderer/src/App.tsx')
  const styles = read('src/renderer/src/styles.css')
  const icons = read('src/renderer/src/components/Icons.tsx')

  it('drops the macOS traffic lights for three rectangular caption buttons', () => {
    // 0.6.6 及更早是 14px 三色圆点，现在改成 Win10 的 46×46 矩形按钮。
    // 只看标题栏那一段：border-radius: 50% 在别处（状态点等）是合法用法。
    const captionArea = styles.slice(styles.indexOf('.window-controls {'), styles.indexOf('.workspace {'))
    expect(captionArea).not.toContain('border-radius: 50%')
    expect(captionArea).not.toContain('#f0b429')
    expect(captionArea).not.toContain('#35a86a')
    expect(captionArea).not.toContain('#e14b3f')
    expect(captionArea).toContain('.caption-button {')
    // 三个彩色圆点的配色不应再出现在样式表任何位置
    expect(styles).not.toContain('#f0b429')
    expect(styles).not.toContain('#35a86a')
    expect(styles).not.toContain('#e14b3f')
  })

  it('sizes the buttons like the Windows 10 caption bar', () => {
    const block = styles.slice(styles.indexOf('.caption-button {'), styles.indexOf('.caption-button:hover'))
    expect(block).toContain('width: 46px')
    expect(block).toContain('min-width: 46px')
    // 按钮高度跟着标题栏变量走，正好铺满标题栏
    expect(block).toContain('height: var(--titlebar-height)')
    expect(block).toContain('min-height: var(--titlebar-height)')
    const titlebar = styles.slice(styles.indexOf('.titlebar {'), styles.indexOf('.app-name {'))
    expect(titlebar).toContain('height: var(--titlebar-height)')
    expect(titlebar).toContain('app-region: drag')
  })

  it('uses the Windows 10 caption height instead of the old macOS one', () => {
    // Win10 标题栏是 32px；0.6.6 及更早沿用 macOS 的 46px，控件栏显得过高
    expect(styles).toContain('--titlebar-height: 32px')
    // 高度只在变量里定义一次，别处都引用它
    expect(styles).not.toContain('height: 46px')
    expect(styles).not.toContain('calc(100vh - 46px)')
    expect(styles).not.toContain('calc(100% - 46px)')
    // 内容区高度要跟着标题栏一起变，否则底部会露出空隙
    expect(styles).toContain('calc(100vh - var(--titlebar-height))')
    expect(styles).toContain('calc(100% - var(--titlebar-height))')
  })

  it('keeps the caption buttons flat and edge to edge', () => {
    // Win10 控件无圆角、无边框、彼此无间距，且贴着窗口右上角
    const controls = styles.slice(styles.indexOf('.window-controls {'), styles.indexOf('.caption-button {'))
    expect(controls).toContain('gap: 0')
    expect(controls).toContain('app-region: no-drag')
    const block = styles.slice(styles.indexOf('.caption-button {'), styles.indexOf('.caption-button:hover'))
    expect(block).toContain('border: 0')
    expect(block).toContain('border-radius: 0')
    expect(block).toContain('background: transparent')
  })

  it('turns the close button red on hover and leaves the others grey', () => {
    expect(styles).toContain('.caption-button:hover {')
    expect(styles).toContain('.caption-button.close:hover {')
    expect(styles).toContain('#e81123')
    // 只有关闭键变红，最小化/最大化沿用中性色
    const grey = styles.slice(styles.indexOf('.caption-button:hover {'), styles.indexOf('.caption-button.close:hover {'))
    expect(grey).not.toContain('#e81123')
  })

  it('renders the four Windows 10 glyphs at caption weight', () => {
    for (const name of ['MinimizeIcon', 'MaximizeIcon', 'RestoreIcon', 'CloseIcon']) {
      expect(icons).toContain(`export function ${name}`)
    }
    // 标题栏字形是 10×10、1px 细线、平头端点，不能用界面图标的 24 格 / 1.8 描边
    const caption = icons.slice(icons.indexOf('function caption('), icons.indexOf('export function MinimizeIcon'))
    expect(caption).toContain("viewBox: '0 0 10 10'")
    expect(caption).toContain('strokeWidth: 1')
    expect(caption).toContain("strokeLinecap: 'butt'")
  })

  it('swaps maximize for restore when the window is maximized', () => {
    expect(app).toContain('function WindowControls({ maximized }')
    expect(app).toContain('<WindowControls maximized={windowMaximized} />')
    expect(app).toContain('{maximized ? <RestoreIcon /> : <MaximizeIcon />}')
    // 无障碍标签要跟着状态走，否则读屏软件会说错
    expect(app).toContain("aria-label={maximized ? '还原' : '最大化'}")
  })

  it('keeps all three controls wired to the window api', () => {
    expect(app).toContain('window.coc.window.minimize()')
    expect(app).toContain('window.coc.window.toggleMaximize()')
    expect(app).toContain('window.coc.window.close()')
    // 双击标题栏仍然切换最大化
    expect(app).toContain('onDoubleClick={() => void window.coc.window.toggleMaximize()}')
  })

  it('does not let the caption buttons steal the drag region', () => {
    expect(styles).toContain('.window-controls,')
    expect(styles).toContain('.window-controls button { -webkit-app-region: no-drag; }')
  })
})
