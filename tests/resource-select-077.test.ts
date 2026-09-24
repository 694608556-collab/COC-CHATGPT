// 0.7.7：归属模组的下拉弹窗要与应用整体风格一致
//
// 用户反馈「新建资料时这个下拉弹窗效果和应用整体风格不一致」。
// 根因：原生 <select> 的**展开列表由操作系统绘制**，CSS 完全管不到
// ——高亮条是系统蓝、字体是系统字体、圆角阴影也都不是应用那一套。
// 改成自绘组件（复用「按名称联想」已有的 .combo-list 样式）。
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const select = fs.readFileSync(
  new URL('../src/renderer/src/components/SelectField.tsx', import.meta.url),
  'utf8'
)
const resources = fs.readFileSync(
  new URL('../src/renderer/src/components/ResourcesPage.tsx', import.meta.url),
  'utf8'
)
const styles = fs.readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')

describe('0.7.7 the module picker is drawn by the app, not by the OS', () => {
  it('no longer uses a native <select> for the module field', () => {
    // 原生 select 的展开列表是系统画的，改不动它的样式。
    // 只看真正的 JSX 标签，注释里提到 <select> 是解释原因，不算
    const jsx = resources.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    expect(jsx).not.toContain('<select')
    expect(jsx).not.toContain('<option')
    // 归属模组这一段应该用自绘组件
    expect(resources).toContain('<SelectField')
    expect(resources).toMatch(/label="归属模组"/)
  })

  it('renders its own listbox instead of relying on the OS popup', () => {
    expect(select).toContain('role="combobox"')
    expect(select).toContain('role="listbox"')
    expect(select).toContain('role="option"')
    expect(select).toContain('aria-expanded={open}')
    // 列表用应用自己的样式类，与「按名称联想」同一套
    expect(select).toContain('className="combo-list"')
    expect(select).toContain("className=\"combo select-field\"")
  })

  it('reuses the shared combo styles so both dropdowns look identical', () => {
    // .combo-list 是已有的联想下拉样式；自绘下拉必须复用它，
    // 否则两处下拉又会各长一个样
    expect(styles).toMatch(/\.combo-list \{/)
    expect(styles).toMatch(/\.combo-list li:hover,\s*\n\.combo-list li\.active/)
    // 收起态是自己画的按钮，不是原生控件
    expect(styles).toMatch(/\.select-trigger \{/)
    expect(styles).toMatch(/\.select-caret \{/)
  })

  it('behaves like a real select: click outside and Esc close it', () => {
    // 自绘控件的代价是这些行为要自己实现，漏掉就会「展开了关不掉」
    expect(select).toContain("document.addEventListener('mousedown', onPointerDown)")
    expect(select).toContain("event.key === 'Escape'")
    expect(select).toContain('setOpen(false)')
  })

  it('supports keyboard navigation', () => {
    // 原生 select 的键盘操作要补齐，否则键盘用户没法选
    expect(select).toContain("event.key === 'ArrowDown'")
    expect(select).toContain("event.key === 'ArrowUp'")
    expect(select).toContain("event.key === 'Enter'")
    expect(select).toContain("event.key === 'Home'")
    expect(select).toContain("event.key === 'End'")
    // 高亮项要滚进可视区，长模组列表用键盘移动时才看得见
    expect(select).toContain('scrollIntoView')
  })

  it('keeps the "no module" option available', () => {
    // 「不归属任何模组」这个选项不能因为换组件而丢
    expect(resources).toContain("label: '不归属任何模组'")
  })
})
