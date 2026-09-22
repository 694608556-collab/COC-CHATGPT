import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')
describe('square Windows 10 window with native resizing', () => {
  const main = read('src/main/index.ts')
  const app = read('src/renderer/src/App.tsx')
  const styles = read('src/renderer/src/styles.css')

  it('uses an opaque square window with native thick-frame resizing enabled', () => {
    expect(main).toContain('transparent: false')
    // 必须同时开启 resizable 与 thickFrame：系统隐形边框才能原生完成八方向缩放；
    // 只开 thickFrame 而 resizable:false 会让边框吞掉鼠标事件且无法缩放（0.6.0 的故障）。
    expect(main).toContain('resizable: true')
    expect(main).toContain('thickFrame: true')
    expect(main).toContain('hasShadow: false')
    expect(main).toContain('roundedCorners: false')
    expect(main).toContain("backgroundColor: '#e6e8ec'")
    expect(main).not.toContain('transparent: true')
    expect(main).not.toContain('resizable: false')
    expect(main).not.toContain("backgroundColor: '#00000000'")
    // 原生缩放仍遵守应用的最小窗口尺寸
    expect(main).toContain('minWidth: 960')
    expect(main).toContain('minHeight: 640')

    const shellBlock = styles.slice(styles.indexOf('.app-shell {'), styles.indexOf('.app-shell.maximized {'))
    expect(shellBlock).toContain('border-radius: 0')
    expect(shellBlock).toContain('box-shadow: none')

    const frameBlock = styles.slice(
      styles.indexOf('.window-frame {'),
      styles.indexOf('.window-frame.maximized {')
    )
    expect(frameBlock).toContain('--window-gutter: 0px')
    expect(frameBlock).toContain('padding: 0')

    // transparent page backgrounds would leave residual blocks behind an opaque window
    const rootBlock = styles.slice(styles.indexOf(':root {'), styles.indexOf(":root[data-theme"))
    expect(rootBlock).toContain('background: var(--bg)')
    const bodyBlock = styles.slice(styles.indexOf('body {'), styles.indexOf('body {') + 200)
    expect(bodyBlock).toContain('background: var(--bg)')
  })

  it('does not render DOM resize handles that fight the native frame', () => {
    expect(app).not.toContain('ResizeHandles')
    expect(styles).not.toContain('.resize-handle')
    expect(styles).not.toContain('window-resizing')
    expect(fs.existsSync(path.join(root, 'src/renderer/src/components/ResizeHandles.tsx'))).toBe(false)
  })

  it('keeps the custom title bar draggable and its buttons click-through safe', () => {
    expect(styles).toContain('.titlebar { -webkit-app-region: drag; }')
    expect(styles).toContain('.window-controls,')
    expect(styles).toContain('.window-controls button { -webkit-app-region: no-drag; }')
  })
})
