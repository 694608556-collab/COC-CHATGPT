// 0.8.1：三处调整
//
// 1) 校验错误提示要指出具体字段与原因
// 2) 跑团记录页的跑团链接不再弹完整地址的悬停窗
// 3) 拖拽时的紫色描边要细，且与卡片外框造型/尺寸完全一致
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = fs.readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8')
const ipc = fs.readFileSync(new URL('../src/main/ipc.ts', import.meta.url), 'utf8')

describe('0.8.1 record link has no hover tooltip', () => {
  it('drops the native title on the record link', () => {
    // 用户反馈「鼠标停留在跑团链接时，过一会会自动出现完整地址的悬停窗，
    // 这个功能在跑团记录页面没有必要」——那是浏览器原生 title
    expect(app).not.toMatch(/className="record-link"\s+title=/)
    expect(app).not.toContain('title={record.link}')
  })

  it('still shows the address text itself', () => {
    // 去掉悬停窗不等于隐藏地址：文字仍然显示（过长由 CSS 截断）
    expect(app).toContain('<small className="record-link">{record.link}</small>')
    // 且 record-link 有截断样式，长地址不会把表格撑破
    const rule = /\.record-link \{([^}]*)\}/.exec(styles)?.[1] ?? ''
    expect(rule).toContain('text-overflow: ellipsis')
    expect(rule).toContain('overflow: hidden')
  })
})

describe('0.8.1 drag outline matches the card exactly', () => {
  it('uses the card own border instead of an inset shadow', () => {
    // 用卡片自身的边框上色：形状（圆角）、尺寸、位置天然与卡片完全一致，
    // 不会出现「描边比卡片小一圈」的观感
    const rule = /body\[data-dragging='true'\] \.resource-tile\[data-dragging='true'\] \{([^}]*)\}/
      .exec(styles)?.[1]
    expect(rule, '应有拖拽描边规则').toBeDefined()
    expect(rule!).toContain('border-color: var(--accent)')
    expect(rule!).toContain('background: transparent')
    // 不再用 inset 阴影（那会看起来比卡片小一圈）
    expect(rule!).not.toContain('box-shadow')
  })

  it('keeps the card border 1px so the outline is not thick', () => {
    // 用户反馈「紫色边框太粗」。0.8.0 的 2px inset 阴影在 125% 缩放下
    // 会渲染成 2.5 设备像素，比卡片本身的 1px 边框粗一大截
    const rule = /\.resource-tile \{([^}]*)\}/.exec(styles)?.[1] ?? ''
    expect(rule).toContain('border: 1px solid transparent')
  })

  it('has no bottom slack left on the card', () => {
    // 卡片底部此前比内容多出一截空白，描边贴着卡片边界画就显得「框小了」。
    // 收紧到 4px 后描边正好箍住内容
    const rule = /\.resource-tile \{([^}]*)\}/.exec(styles)?.[1] ?? ''
    const padding = /padding:\s*([^;]+);/.exec(rule)?.[1] ?? ''
    console.log('卡片内边距:', padding.trim())
    expect(padding).toContain('30px 6px 4px')
  })
})

describe('0.8.1 validation errors name the field', () => {
  it('formats zod issues into readable Chinese', () => {
    expect(ipc).toContain('describeValidationError')
    expect(ipc).toContain('describeIssue')
    // 具体到字段的措辞
    expect(ipc).toContain('缺少必填内容')
    expect(ipc).toContain('内容过长，最多')
    expect(ipc).toContain('不是有效的网址')
    expect(ipc).toContain('数据可能已损坏')
  })

  it('maps field names to user-facing labels', () => {
    expect(ipc).toContain('FIELD_LABELS')
    // 关键的几个字段都要有中文名
    for (const label of ["title: '标题'", "url: '链接地址'", "note: '备注'", "id: '资料 ID'"]) {
      expect(ipc, `应有 ${label}`).toContain(label)
    }
  })

  it('no longer answers every failure with the same generic sentence', () => {
    // 通用兜底仍然保留（真的取不到信息时用），但不能是唯一出口。
    // 只数**代码里**的出现次数，注释里提到这句话是在解释历史，不算
    const code = ipc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    const generic = (code.match(/输入内容不完整或格式不正确/g) ?? []).length
    console.log(`通用提示在代码里出现 ${generic} 次（应为 1 次：仅作兜底）`)
    expect(generic).toBe(1)
  })
})
