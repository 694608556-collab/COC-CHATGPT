/**
 * 0.7.1 阶段 5：资料卡片的操作图标改为四个等宽图标。
 *
 * 用户要求：
 * - 原「文件夹」图标的功能改为「打开文件所在位置」，提示词跟着改
 * - 在「更新」与「文件夹」之间新增「编辑」图标，功能是「用源程序打开」
 *   （导图交给 EdrawMind、文档交给 Word、图片交给默认看图器）
 * - 四个图标大小一致、正好占满卡片顶部
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

describe('0.7.1 stage 5: four equal action icons', () => {
  it('has exactly four actions in the documented order', () => {
    const page = read('src/renderer/src/components/ResourcesPage.tsx')
    const block = page.slice(page.indexOf('resource-tile-actions'), page.indexOf('const renderGroup'))
    // 四个动作按顺序：更新 / 编辑 / 打开文件所在位置 / 移除
    const order = ['更新', '编辑', '打开文件所在位置', '从汇总里移除']
    let cursor = -1
    for (const label of order) {
      const at = block.indexOf(label, cursor + 1)
      expect(at, `找不到「${label}」或顺序不对`).toBeGreaterThan(cursor)
      cursor = at
    }
    // 正好四个带提示的图标按钮
    expect((block.match(/data-tip=/g) ?? []).length).toBe(4)
  })

  it('points the edit icon at the original application', () => {
    const page = read('src/renderer/src/components/ResourcesPage.tsx')
    expect(page).toContain('openInOriginalApp')
    // 编辑图标用铅笔
    expect(page).toContain('PencilIcon')
  })

  it('reveals the file in the file manager instead of opening it', () => {
    const page = read('src/renderer/src/components/ResourcesPage.tsx')
    expect(page).toContain('showItem')
    // 打开所在位置只对本地文件有意义，链接没有路径
    expect(page).toContain('resource.path')
  })

  it('makes the four icons fill the card top evenly', () => {
    const styles = read('src/renderer/src/styles.css')
    const block = styles.slice(styles.indexOf('.resource-tile-actions'))
    const rule = block.slice(0, block.indexOf('}'))
    // 四个等宽图标平分整行
    expect(rule).toContain('grid')
    expect(rule).toContain('repeat(4')
  })
})
