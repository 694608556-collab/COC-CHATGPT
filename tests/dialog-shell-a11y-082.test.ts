// 0.8.2：DialogShell 的关闭键无障碍名称
//
// 做演示脚本时发现的真 bug：DialogShell 里关闭键写的是
//   aria-label="\u5173\u95ed\u5bf9\u8bdd\u6846"
// JSX 属性是**字符串字面量**，里面的 \u 转义不会被解析，于是无障碍名称
// 变成了这串反斜杠文本。屏幕阅读器读不出来，自动化也定位不到
// （探针里找「关闭对话框」一个都找不到）。
//
// 这个 bug 从 0.3.0（2026-09-15）就存在，影响了所有用 DialogShell 的弹窗。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

/** 递归收集所有 .tsx */
function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) tsxFiles(full, out)
    else if (entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

describe('0.8.2 dialog close button is reachable', () => {
  it('gives the close button a real accessible name', () => {
    const shell = read('src/renderer/src/components/DialogShell.tsx')
    expect(shell).toContain('aria-label="关闭对话框"')
    // 不能再出现「属性里带反斜杠 u 转义」的写法
    expect(shell).not.toMatch(/aria-label="\\u/)
  })

  it('has no JSX attribute left with an unescaped \\u sequence', () => {
    /*
     * 同类问题的通用防线。
     *
     * JSX 属性值是字符串字面量，`aria-label="\u5173"` 不会被解析成中文；
     * 想用转义必须写成表达式 `aria-label={'\u5173'}`。
     * 全仓库扫一遍，避免以后再犯。
     */
    const offenders: string[] = []
    const pattern = /[a-zA-Z-]+="[^"]*\\u[0-9a-fA-F]{4}[^"]*"/
    for (const file of tsxFiles(path.join(root, 'src'))) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        // 跳过注释行：注释里提到这个写法是在解释历史
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
        if (pattern.test(line)) {
          offenders.push(`${path.relative(root, file)}:${index + 1}  ${trimmed}`)
        }
      })
    }
    if (offenders.length) console.log('有问题的行:\n' + offenders.join('\n'))
    expect(offenders, '不该有 JSX 属性使用未解析的 \\u 转义').toEqual([])
  })

  it('keeps every DialogShell consumer closable by that name', () => {
    // 所有用 DialogShell 的弹窗都会得到同一个关闭键，
    // 所以这个名称一旦写错，受影响的是全部弹窗
    const shell = read('src/renderer/src/components/DialogShell.tsx')
    expect(shell).toContain('className="icon-button"')
    expect(shell).toContain('onClick={onClose}')

    const consumers = tsxFiles(path.join(root, 'src/renderer/src'))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('<DialogShell'))
      .map((file) => path.basename(file))
    console.log(`用 DialogShell 的组件（${consumers.length} 个）: ${consumers.join(', ')}`)
    expect(consumers.length).toBeGreaterThanOrEqual(3)
  })
})
