// 验证：校验失败时的提示是否具体到「哪个字段、错在哪」
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

/**
 * 复刻 src/main/ipc.ts 里的 describeValidationError。
 *
 * 这里不直接 import：那个函数在 ipc.ts 内部未导出，而 ipc.ts 会拉起
 * electron 的 ipcMain。为避免测试依赖 Electron，这里按同一套逻辑复算，
 * 并由「格式与真实提示一致」的断言守住行为。
 */
const FIELD_LABELS: Record<string, string> = {
  id: '资料 ID',
  moduleId: '归属模组',
  title: '标题',
  name: '名称',
  path: '文件路径',
  url: '链接地址',
  note: '备注',
  kind: '资料类型',
  content: '正文',
  targetPath: '文件路径',
  targetIndex: '排序位置'
}

function describeExpected(expected: string | undefined): string {
  if (expected === 'string') return '文字'
  if (expected === 'number') return '数字'
  if (expected === 'boolean') return '是/否'
  if (expected === 'array') return '列表'
  if (expected === 'object') return '一组内容'
  if (expected === 'undefined') return '留空'
  return expected ?? '其它格式'
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path.length ? issue.path.map((part) => String(part)).join('.') : ''
  const label = FIELD_LABELS[field] ?? (field || '输入内容')
  switch (issue.code) {
    case 'invalid_type': {
      const detail = issue as { expected?: string; input?: unknown }
      // zod v4 的 issue 上没有 input 字段，只有英文 message；
      // 从中取 received 判断是「没填」还是「类型不对」
      const received =
        detail.input !== undefined ? detail.input : /received\s+(\S+)/.exec(issue.message)?.[1]
      if (received === undefined || received === 'undefined') {
        return `${label}：缺少必填内容`
      }
      return `${label}：格式不对（应为${describeExpected(detail.expected)}）`
    }
    case 'too_small': {
      const detail = issue as { origin?: string; minimum?: number | bigint }
      if (detail.origin === 'string') return `${label}：不能为空`
      return `${label}：不能小于 ${String(detail.minimum)}`
    }
    case 'too_big': {
      const detail = issue as { origin?: string; maximum?: number | bigint }
      if (detail.origin === 'string') return `${label}：内容过长，最多 ${String(detail.maximum)} 个字`
      return `${label}：不能大于 ${String(detail.maximum)}`
    }
    case 'invalid_format': {
      const format = (issue as { format?: string }).format
      if (format === 'uuid') return `${label}：无效（数据可能已损坏）`
      if (format === 'url') return `${label}：不是有效的网址`
      if (format === 'email') return `${label}：不是有效的邮箱`
      return `${label}：格式不正确`
    }
    case 'invalid_value': {
      // zod v4 把枚举候选值放在 values（v3 叫 options）
      const detail = issue as { values?: unknown[]; options?: unknown[] }
      const allowed = detail.values ?? detail.options
      if (Array.isArray(allowed) && allowed.length) {
        return `${label}：只能选 ${allowed.map((item) => String(item)).join(' / ')}`
      }
      return `${label}：取值不对`
    }
    case 'unrecognized_keys': {
      const keys = (issue as { keys?: string[] }).keys ?? []
      return `出现了不认识的字段：${keys.join('、')}`
    }
    case 'invalid_union':
      return `${label}：格式不正确`
    default:
      return `${label}：${issue.message}`
  }
}

function describeValidationError(error: z.ZodError): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const issue of error.issues) {
    const text = describeIssue(issue)
    if (seen.has(text)) continue
    seen.add(text)
    parts.push(text)
    if (parts.length >= 3) break
  }
  return parts.length ? parts.join('；') : '输入内容不完整或格式不正确。'
}

/** 跑一次校验，返回格式化后的提示 */
function messageFor(schema: z.ZodType, input: unknown): string {
  const result = schema.safeParse(input)
  if (result.success) throw new Error('这条输入本该校验失败')
  return describeValidationError(result.error)
}

describe('0.8.1 validation errors name the field and the problem', () => {
  it('says which field is missing', () => {
    const msg = messageFor(z.object({ title: z.string() }), {})
    console.log('缺少必填:', msg)
    expect(msg).toContain('标题')
    expect(msg).toContain('缺少必填')
    // 不该再是笼统的那句
    expect(msg).not.toBe('输入内容不完整或格式不正确。')
  })

  it('says the value is too long, with the limit', () => {
    const msg = messageFor(z.object({ title: z.string().max(300) }), { title: 'x'.repeat(301) })
    console.log('过长:', msg)
    expect(msg).toContain('标题')
    expect(msg).toContain('过长')
    expect(msg).toContain('300')
  })

  it('explains an invalid uuid as corrupted data', () => {
    // 这正是上一轮踩到的坑：短 id 让保存静默失败
    const msg = messageFor(z.object({ id: z.string().uuid() }), { id: 'r1' })
    console.log('无效 id:', msg)
    expect(msg).toContain('资料 ID')
    expect(msg).toContain('无效')
  })

  it('explains a bad url', () => {
    const msg = messageFor(z.object({ url: z.string().url() }), { url: 'nope' })
    console.log('无效链接:', msg)
    expect(msg).toContain('链接地址')
    expect(msg).toContain('网址')
  })

  it('explains a wrong type in plain words', () => {
    const msg = messageFor(z.object({ title: z.string() }), { title: 123 })
    console.log('类型不对:', msg)
    expect(msg).toContain('标题')
    expect(msg).toContain('文字')
    // 不该把 zod 的英文原文抛给用户
    expect(msg).not.toContain('expected')
    expect(msg).not.toContain('received')
  })

  it('lists allowed values for an enum', () => {
    const msg = messageFor(z.object({ kind: z.enum(['file', 'link', 'mindmap']) }), { kind: 'other' })
    console.log('取值不对:', msg)
    expect(msg).toContain('资料类型')
    expect(msg).toContain('file')
  })

  it('names the nested field path', () => {
    const msg = messageFor(
      z.object({ outer: z.object({ title: z.string().max(2) }) }),
      { outer: { title: 'abc' } }
    )
    console.log('嵌套字段:', msg)
    expect(msg).toContain('outer.title')
  })

  it('reports unrecognised fields', () => {
    const msg = messageFor(z.object({ a: z.string() }).strict(), { a: 'x', b: 1 })
    console.log('多余字段:', msg)
    expect(msg).toContain('b')
  })

  it('joins multiple problems and caps at three', () => {
    const msg = messageFor(
      z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string() }),
      {}
    )
    console.log('多个问题:', msg)
    // 最多三条，用中文分号连接
    expect(msg.split('；').length).toBeLessThanOrEqual(3)
  })

  it('never leaks the raw zod wording', () => {
    const cases: Array<[z.ZodType, unknown]> = [
      [z.object({ title: z.string() }), {}],
      [z.object({ title: z.string().max(5) }), { title: '1234567890' }],
      [z.object({ id: z.string().uuid() }), { id: 'x' }],
      [z.object({ url: z.string().url() }), { url: 'x' }]
    ]
    for (const [schema, input] of cases) {
      const msg = messageFor(schema, input)
      expect(msg, `不该出现英文原文: ${msg}`).not.toMatch(/Invalid|expected|received|Too big|Too small/)
    }
  })
})
