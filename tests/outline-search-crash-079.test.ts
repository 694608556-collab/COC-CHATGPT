// 0.7.9：全模组正文搜索不能把应用搞死（白屏）
//
// 用户反馈（严重）：「跑团记录页面，全模组正文搜索框，输入任意字符会导致应用死机，
// 只能强行退出。这个是最基础的功能，怎么还能被破坏？」
//
// 实测定位（真实运行的应用 + 用户的数据库）：
//   TypeError: line.toLocaleLowerCase is not a function
//       at searchOutline
//       at moduleOutlineHits
//       at App
//   渲染时抛异常 → React 卸载整棵组件树 → document.body.innerText 长度为 0
//   （用户看到的就是「死机/白屏」）
//
// 根因是**类型不一致**：
//   IPC 的 resources:read-mindmap 返回 outline: Array<{ text: string; depth: number }>
//   而 App.tsx 里 outlineCache 声明成 Record<string, string[]>，
//   moduleOutlineHits 直接把对象数组当字符串数组传给 searchOutline。
//   类型写错让这个 bug 通过了类型检查，只有运行时才炸。
//
// 修法：按真实结构声明类型（MindmapPreviewApi['outline']），取 text；
// 并加一道 filter 兜住坏数据，避免以后再出现「一个字段不对就白屏」。
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { searchOutline } from '../src/shared/record-search'

const app = fs.readFileSync(
  new URL('../src/renderer/src/App.tsx', import.meta.url),
  'utf8'
)

describe('0.7.9 outline search never crashes on the real data shape', () => {
  it('declares the outline cache as the real IPC shape, not string[]', () => {
    // 类型必须与 IPC 一致：错写成 string[] 就会让「把对象当字符串」通过类型检查
    expect(app).toMatch(
      /const \[outlineCache, setOutlineCache\] = useState<Record<string, MindmapPreviewApi\['outline'\]>>/
    )
    expect(app).not.toMatch(/useState<Record<string, string\[\]>>\(\{\}\)/)
  })

  it('maps outline rows to their text before searching', () => {
    // searchOutline 只认字符串；必须取 .text
    expect(app).toMatch(/\.map\(\(line\) => line\?\.text\)/)
    // 并且兜住非字符串，坏数据不该再炸掉整页
    expect(app).toMatch(/typeof text === 'string'/)
  })

  it('the crash is reproducible if rows are passed as objects', () => {
    // 把对象数组传进去就是原来的崩法：line.toLocaleLowerCase 不是函数。
    // 这条用例把「为什么必须取 .text」钉住。
    // 注意：TypeScript 现在**能**拦住这种写法（类型已按真实结构声明），
    // 所以要绕开类型检查来复现运行时的崩溃
    const wrongRows = [{ text: '调查员', depth: 0 }] as unknown as string[]
    const entries = [{ resourceId: 'r1', resourceTitle: '世界回归进行曲', lines: wrongRows }]
    expect(() => searchOutline(entries, '调查')).toThrow(TypeError)
  })

  it('works when given the correctly mapped text array', () => {
    const entries = [
      {
        resourceId: 'r1',
        resourceTitle: '世界回归进行曲',
        lines: ['调查员来到了村庄', '与邪教徒交战', '调查员的理智下降']
      }
    ]
    const hits = searchOutline(entries, '调查')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.matches).toBe(2)
    expect(hits[0]!.lines).toHaveLength(2)
  })

  it('tolerates undefined rows instead of throwing', () => {
    // 坏数据（大纲里混进 undefined）不该让整页白屏
    const rows: Array<{ text?: string } | undefined> = [
      { text: '调查员' },
      undefined,
      { text: undefined },
      { text: '邪教徒' }
    ]
    const lines = rows
      .map((line) => line?.text)
      .filter((text): text is string => typeof text === 'string' && text.length > 0)
    expect(lines).toEqual(['调查员', '邪教徒'])
    expect(() => searchOutline([{ resourceId: 'r', resourceTitle: 't', lines }], '调查')).not.toThrow()
  })
})
