// 0.7.5：折叠分支不再画出来。
//
// 用户反复反馈的「文字框重叠」根因：EdrawMind 折叠一个分支时不会删掉那些节点，
// 只给它们加上 <TogglerID> 标记并在界面上隐藏。我们此前把折叠的节点照常画了
// 出来，而它们的坐标还停在折叠前的位置，于是压在正常显示的节点上。
//
// 判定规则用 EdrawMind 自己的 HTML 导出逐节点验证：877 个节点里带 TogglerID
// 的 265 个，与导出里的 display:none 完全一一对应（误判 0、漏判 0）。
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pageToSvg, parseEmmx } from '../src/shared/emmx'
import { samplePath } from './sample-files'

const WORLD = samplePath('世界回归进行曲')
const DRAGON = samplePath('龙台掠雪')
const RUST = samplePath('锈蚀纪元')
const ABYSS = samplePath('渊娲之海')

/** 造一个最小 .emmx（未压缩 zip 条目 + page.xml） */
function emmx(xml: string): Buffer {
  const payload = Buffer.from(xml, 'utf8')
  const name = Buffer.from('page/page.xml', 'utf8')
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(0, 8)
  header.writeUInt32LE(payload.length, 18)
  header.writeUInt32LE(payload.length, 22)
  header.writeUInt16LE(name.length, 26)
  return Buffer.concat([header, name, payload])
}

/** 一个普通节点 */
function node(
  id: string,
  text: string,
  opts: { cx?: number; cy?: number; superV?: string; toggler?: string; subLevel?: string[] } = {}
): string {
  const { cx = 100, cy = 100, superV, toggler, subLevel } = opts
  const level =
    `<LevelData>` +
    (toggler === undefined ? '' : `<TogglerID V="${toggler}"/>`) +
    (superV === undefined ? '' : `<Super V="${superV}"/>`) +
    (subLevel && subLevel.length ? `<SubLevel V="${subLevel.join(';')}"/>` : '') +
    `</LevelData>`
  return (
    `<Shape ID="${id}" Type="SubTopic"><Transform><Width V="100"/><Height V="28"/>` +
    `<CX V="${cx}" B="1" P="0"/><CY V="${cy}" B="2" P="0"/></Transform>` +
    `<TextBlock><Character IX="0" Size="12" Color="#333333"/>` +
    `<Text><pp PX="0" CX="0"><tp>${text}</tp></pp></Text></TextBlock>` +
    level +
    `</Shape>`
  )
}

/**
 * 被折叠的子节点。
 *
 * 真实文件里它同时带 `<TogglerID V="父"/>` 和 `<Super V="父"/>`：TogglerID 说明
 * 「属于被折叠的分支」，Super 说明父子关系。两个都写才与 EdrawMind 存的一致。
 */
function foldedChild(id: string, text: string, parent: string, cy = 100): string {
  return node(id, text, { cy, superV: parent, toggler: parent })
}

/** 一条连线 */
function connector(id: string, parent: string, toggler?: string): string {
  return (
    `<Shape ID="${id}" Type="MMConnector"><Transform><Width V="27"/><Height V="1"/>` +
    `<CX V="150" B="1" P="0"/><CY V="100" B="2" P="0"/></Transform>` +
    `<LevelData>` +
    (toggler === undefined ? '' : `<TogglerID V="${toggler}"/>`) +
    `<Super V="${parent}"/></LevelData>` +
    `<Geometries><Geometry Closed="0"><MoveTo><X V="0"/><Y V="0"/></MoveTo>` +
    `<LineTo><X V="27"/><Y V="0"/></LineTo></Geometry></Geometries></Shape>`
  )
}

function pageOf(...shapes: string[]): string {
  return (
    `<?xml version="1.0"?><Page ID="100" Type="Page" Name="画布 1">` +
    `<PageProps><Width V="2000"/><Height V="2000"/></PageProps>` +
    shapes.join('') +
    `</Page>`
  )
}

describe('0.7.5 folded branches are not drawn', () => {
  it('marks a node as hidden when it carries a TogglerID', () => {
    const doc = parseEmmx(emmx(pageOf(node('1', '父节点'), node('2', '被折叠的子节点', { toggler: '1' }))))
    const [parent, child] = doc.pages[0]!.shapes
    expect(parent!.hidden).toBeUndefined()
    expect(child!.hidden).toBe(true)
  })

  it('does not draw hidden nodes, but still draws visible ones', () => {
    const doc = parseEmmx(
      emmx(pageOf(node('1', '看得见的'), node('2', '折叠掉的', { toggler: '1', cx: 100, cy: 100 })))
    )
    const svg = pageToSvg(doc.pages[0]!)
    expect(svg).toContain('看得见的')
    expect(svg).not.toContain('折叠掉的')
    // data-shape 也不该出现，否则搜索会定位到一个不存在的框
    expect(svg).not.toContain('data-shape="2"')
    expect(svg).toContain('data-shape="1"')
  })

  it('counts how many direct children are folded, and draws a badge', () => {
    const doc = parseEmmx(
      emmx(
        pageOf(
          node('1', '折叠点', { subLevel: ['2', '3'] }),
          foldedChild('2', '子一', '1', 80),
          foldedChild('3', '子二', '1', 120)
        )
      )
    )
    expect(doc.pages[0]!.shapes[0]!.foldedCount).toBe(2)
    const svg = pageToSvg(doc.pages[0]!)
    // 徽标画在折叠点右侧，带 data-fold 便于定位
    expect(svg).toContain('data-fold="1"')
    expect(svg).toMatch(/data-fold="1"[^>]*\/>\n<text[^>]*>2<\/text>/)
    // 数字必须标成 data-fold-text：节点文字的行数校验按 <text> 数行，
    // 不标出来徽标数字会被算成一行（0.7.3 的溢出测试就会误报）
    expect(svg).toMatch(/<text data-fold-text="1"[^>]*>2<\/text>/)
  })

  it('does not count a folded connector as a folded child', () => {
    // 折叠一个子节点时，它自己【和】连到它的线都带同一个 TogglerID，
    // 而连线也有 <Super>。不排除连线就会把每个子节点数成两次。
    const doc = parseEmmx(
      emmx(
        pageOf(
          node('1', '折叠点', { subLevel: ['2'] }),
          foldedChild('2', '子一', '1'),
          connector('3', '1', '1')
        )
      )
    )
    expect(doc.pages[0]!.shapes[0]!.foldedCount).toBe(1)
  })

  it('keeps folded text in the outline so search and export still find it', () => {
    // 折叠只是不显示，内容不能丢——否则搜索与导出大纲会少东西
    const doc = parseEmmx(
      emmx(pageOf(node('1', '父节点', { subLevel: ['2'] }), foldedChild('2', '折叠的内容', '1')))
    )
    expect(doc.outline.map((line) => line.text)).toContain('折叠的内容')
  })

  it('keeps the outline hierarchy instead of making every node a root', () => {
    const doc = parseEmmx(
      emmx(
        pageOf(
          node('1', '根', { subLevel: ['2'] }),
          node('2', '中间', { superV: '1', subLevel: ['3'] }),
          node('3', '叶子', { superV: '2' })
        )
      )
    )
    const leaf = doc.outline.find((line) => line.text === '叶子')
    const middle = doc.outline.find((line) => line.text === '中间')
    // 层级要真的接起来：1 → 2 → 3。若 <Super> 丢了，每个节点都会变成
    // 深度 0 的根，大纲就成了一堆平铺的行。
    expect(middle!.depth).toBe(1)
    expect(leaf!.depth).toBe(2)
  })

  it('reads a node whose child shape is nested inside it', () => {
    // EdrawMind 把星标（Mark）嵌在节点内部，而且排在节点自己的 <LevelData> 之前。
    // 非贪婪匹配 <Shape ...>([\s\S]*?)</Shape> 会在星标结束处截断，
    // 父节点的 <Super>/<SubLevel>/<TogglerID> 就全丢了。
    const inner =
      `<Shape ID="9" Type="Mark"><Transform><Width V="17"/><Height V="17"/>` +
      `<CX V="17.5" B="1" P="0"/><CY V="14.3" B="2" P="0"/></Transform>` +
      `<Geometries><Geometry Closed="1"><MoveTo><X V="0"/><Y V="0"/></MoveTo></Geometry></Geometries></Shape>`
    const parent =
      `<Shape ID="1" Type="SubTopic"><Transform><Width V="100"/><Height V="28"/>` +
      `<CX V="100" B="1" P="0"/><CY V="100" B="2" P="0"/></Transform>` +
      inner +
      `<TextBlock><Character IX="0" Size="12" Color="#333333"/>` +
      `<Text><pp PX="0" CX="0"><tp>带星标</tp></pp></Text></TextBlock>` +
      `<LevelData><TogglerID V="7"/><Super V="7"/><SubLevel V="3"/></LevelData></Shape>`
    const doc = parseEmmx(
      emmx(pageOf(node('7', '祖父', { subLevel: ['1'] }), parent, node('3', '孙', { superV: '1' })))
    )

    const shape = doc.pages[0]!.shapes.find((item) => item.id === '1')!
    // 关键：截断会丢掉 TogglerID，这个节点就会照常被画出来
    expect(shape.hidden).toBe(true)
    // 星标本身不当成独立节点画（它的坐标相对父框左上角）
    expect(doc.pages[0]!.shapes.some((item) => item.id === '9')).toBe(false)
    // 层级也要接上：非贪婪匹配会让「孙」接不回父节点
    const grandchild = doc.outline.find((line) => line.text === '孙')
    expect(grandchild!.depth).toBe(2)
  })
})

describe('0.7.5 real maps: folded nodes no longer overlap', () => {
  it.skipIf(!WORLD)('removes every overlap in the map the user reported', () => {
    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    const visible = page.shapes.filter((shape) => !shape.hidden && shape.lines.length)
    const pairs: string[] = []
    for (let i = 0; i < visible.length; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        const a = visible[i]!
        const b = visible[j]!
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        if (ox > 0.5 && oy > 0.5) pairs.push(`${a.id}×${b.id}`)
      }
    }
    // 折叠前实测 327 对重叠；隐藏折叠分支后必须是 0
    expect(visible.length).toBeGreaterThan(500)
    expect(pairs, `仍有 ${pairs.length} 对重叠: ${pairs.slice(0, 5).join(' ')}`).toEqual([])
  })

  it.skipIf(!WORLD)('hides the exact nodes EdrawMind hides, in the reported area', () => {
    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    const byId = new Map(page.shapes.map((shape) => [shape.id, shape]))
    // 用户截图里压住别人的那两个框，都属于被折叠的「妖魔」分支
    expect(byId.get('1382')!.hidden).toBe(true)
    expect(byId.get('1385')!.hidden).toBe(true)
    // 被压住的、以及折叠点自己，都必须照常显示
    expect(byId.get('213')!.hidden).toBeUndefined()
    expect(byId.get('1380')!.hidden).toBeUndefined()
    expect(byId.get('1380')!.foldedCount).toBeGreaterThan(0)
  })

  it.skipIf(!WORLD)('still exports every folded line to the outline', () => {
    const doc = parseEmmx(fs.readFileSync(WORLD!))
    const texts = doc.outline.map((line) => line.text)
    for (const text of ['仅接受绝对实力的威吓', '被注入共生体', '与本体形成平衡']) {
      expect(texts.some((line) => line.includes(text)), `大纲里应有「${text}」`).toBe(true)
    }
  })

  it.skipIf(!WORLD)('fits the canvas to visible content instead of the folded sprawl', () => {
    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    // 折叠分支里有 82 个图形落在可见范围之外（最远 y=9106），
    // 把它们算进包围盒会撑出一大片空白
    expect(page.bounds.maxY).toBeLessThan(8500)
    const svg = pageToSvg(page)
    const viewBox = svg.match(/viewBox="([^"]+)"/)![1]!.split(' ').map(Number)
    expect(viewBox[3]!).toBeLessThan(8600)
  })

  it.skipIf(!WORLD)('draws a fold badge for every visible fold point', () => {
    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    const folds = page.shapes.filter((shape) => shape.foldedCount && !shape.hidden)
    expect(folds.length).toBeGreaterThan(10)
    const svg = pageToSvg(page)
    for (const fold of folds) expect(svg).toContain(`data-fold="${fold.id}"`)
    // 被折叠的节点自己不该有徽标（画了也看不见，还会误导）
    for (const shape of page.shapes.filter((item) => item.hidden && item.foldedCount)) {
      expect(svg).not.toContain(`data-fold="${shape.id}"`)
    }
  })

  it.skipIf(!DRAGON || !RUST)('leaves maps without folded branches untouched', () => {
    // 这两份导图本来就没有重叠，修复不该动它们一个节点
    for (const file of [DRAGON!, RUST!]) {
      const page = parseEmmx(fs.readFileSync(file)).pages[0]!
      expect(page.shapes.filter((shape) => shape.hidden)).toEqual([])
      expect(page.paths.filter((path) => path.hidden)).toEqual([])
      expect(page.shapes.filter((shape) => shape.foldedCount)).toEqual([])
    }
  })

  it.skipIf(!ABYSS)('hides folded nodes in a second affected map too', () => {
    const page = parseEmmx(fs.readFileSync(ABYSS!)).pages[0]!
    const hidden = page.shapes.filter((shape) => shape.hidden)
    expect(hidden.length).toBeGreaterThan(0)
    const visible = page.shapes.filter((shape) => !shape.hidden && shape.lines.length)
    let pairs = 0
    for (let i = 0; i < visible.length; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        const a = visible[i]!
        const b = visible[j]!
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        if (ox > 0.5 && oy > 0.5) pairs += 1
      }
    }
    expect(pairs).toBe(0)
  })
})

describe('0.7.5 hidden rule matches EdrawMind exactly', () => {
  const HTML =
    'C:\\Users\\Admin\\AppData\\Roaming\\dsh-launcher\\dsh-packs\\pack-test\\attachments\\v1\\files\\ee\\ee859ad50311abd12b5132b95515d216a6ecec259a5bd0c8b115007e8a84d169\\世界回归进行曲.html'
  const available = Boolean(WORLD) && fs.existsSync(HTML)

  it.skipIf(!available)('hides exactly the nodes EdrawMind marks display:none', () => {
    // 拿 EdrawMind 自己的 HTML 导出当标准答案：两者必须逐节点一致。
    // 注意 <g>（节点）和 <path>（连线、概括括号）都要收进隐藏集合。
    const html = fs.readFileSync(HTML, 'utf8')
    const htmlHidden = new Map<string, boolean>()
    for (const m of html.matchAll(/<g\s+id="(\d+)"([^>]*)>/g)) {
      htmlHidden.set(m[1]!, /display\s*:\s*none/.test(m[2]!))
    }
    for (const m of html.matchAll(/<path\s+id="(\d+)"([^>]*)>/g)) {
      htmlHidden.set(m[1]!, /display\s*:\s*none/.test(m[2]!))
    }

    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    const ours = new Map(page.shapes.map((shape) => [shape.id, Boolean(shape.hidden)]))
    for (const path of page.paths) ours.set(path.id, Boolean(path.hidden))

    const wrong: string[] = []
    let checked = 0
    for (const [id, expected] of htmlHidden) {
      const actual = ours.get(id)
      // HTML 里有、我们没解析成图形的（如 <symbol> 图标）不参与比对
      if (actual === undefined) continue
      checked += 1
      if (actual !== expected) wrong.push(`${id}: 我们=${actual} EdrawMind=${expected}`)
    }
    expect(checked).toBeGreaterThan(800)
    expect(wrong, `与 EdrawMind 不一致 ${wrong.length} 处: ${wrong.slice(0, 5).join(' ')}`).toEqual([])
  })

  it.skipIf(!available)('shows the same fold counts as EdrawMind', () => {
    const html = fs.readFileSync(HTML, 'utf8')
    const hidden = new Set<string>()
    const parent = new Map<string, string>()
    for (const m of html.matchAll(/<g\s+id="(\d+)"([^>]*)>/g)) {
      if (/display\s*:\s*none/.test(m[2]!)) hidden.add(m[1]!)
      const p = /ed:parentid="(\d+)"/.exec(m[2]!)?.[1]
      if (p) parent.set(m[1]!, p)
    }
    for (const m of html.matchAll(/<path\s+id="(\d+)"([^>]*)>/g)) {
      if (/display\s*:\s*none/.test(m[2]!)) hidden.add(m[1]!)
    }
    const kids = new Map<string, string[]>()
    for (const [child, p] of parent) {
      if (!kids.has(p)) kids.set(p, [])
      kids.get(p)!.push(child)
    }
    const expected = new Map<string, number>()
    for (const [id, children] of kids) {
      if (hidden.has(id)) continue
      const count = children.filter((child) => hidden.has(child)).length
      if (count) expected.set(id, count)
    }

    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    const ours = new Map(
      page.shapes
        .filter((shape) => shape.foldedCount)
        .map((shape) => [shape.id, shape.foldedCount!])
    )
    // 只比对会画出来的那些（被折叠的节点自己也有 foldedCount，但不显示徽标）
    const drawn = new Map([...ours].filter(([id]) => !page.shapes.find((s) => s.id === id)!.hidden))
    expect(drawn.size).toBeGreaterThan(10)
    expect([...drawn.entries()].sort()).toEqual([...expected.entries()].sort())
  })

  it.skipIf(!available)('keeps exactly the connectors EdrawMind keeps', () => {
    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    // 折叠分支里的连线同样带 TogglerID，不该画；数量与 EdrawMind 导出一致。
    // 若把连线漏掉，画面上会留下指向空处的线头。
    //
    // 口径说明：EdrawMind 的 HTML 里，Callout（标注框）走 <g>、其余走 <path>，
    // 而我们一律收进 paths，所以两边的「path 条数」天然差 2（157、1771 两个
    // Callout）。用集合比对（见下一个用例）比数数更可靠，这里只钉住总数。
    const connectors = page.paths.filter(
      (path) => path.type === 'MMConnector' || path.type === 'RelatConnector'
    )
    expect(connectors.filter((path) => !path.hidden).length).toBe(594)
    expect(connectors.filter((path) => path.hidden).length).toBe(260)
    expect(page.shapes.filter((shape) => shape.hidden).length).toBe(265)
  })

  it.skipIf(!available)('never hides anything EdrawMind shows', () => {
    // 最关键的方向：把 EdrawMind 显示的东西误判成隐藏，会让用户丢内容。
    // 反向（EdrawMind 隐藏、我们显示）只会造成重叠，不会丢内容。
    const html = fs.readFileSync(HTML, 'utf8')
    const htmlVisible = new Set<string>()
    for (const m of html.matchAll(/<path\s+id="(\d+)"([^>]*)>/g)) {
      if (!/display\s*:\s*none/.test(m[2]!)) htmlVisible.add(m[1]!)
    }
    for (const m of html.matchAll(/<g\s+id="(\d+)"([^>]*)>/g)) {
      if (!/display\s*:\s*none/.test(m[2]!)) htmlVisible.add(m[1]!)
    }

    const page = parseEmmx(fs.readFileSync(WORLD!)).pages[0]!
    const wronglyHidden: string[] = []
    for (const shape of page.shapes) {
      if (shape.hidden && htmlVisible.has(shape.id)) wronglyHidden.push(shape.id)
    }
    for (const path of page.paths) {
      if (path.hidden && htmlVisible.has(path.id)) wronglyHidden.push(path.id)
    }
    expect(wronglyHidden, `误判为隐藏: ${wronglyHidden.slice(0, 10).join(' ')}`).toEqual([])
  })
})
