// 0.8.2：卡片留白均衡 + 灰色占位保留外框
//
// 1) 用户反馈「鼠标挪开后，整体展示效果看起来就像顶部空缺了一块，看起来不舒服」。
//    根因：0.7.7 为了让悬停时的四个按钮不压住图标，把顶部空间**恒定**留了出来
//    （30px），结果不悬停时顶部空 30.8px、底部只剩 4.8px，头重脚轻。
//    用户的选择：图标与名称整体上移，接受悬停时轻微重合。
//
// 2) 用户反馈「链接类资料的灰色文件夹图标同样保留外框造型，不然看起来也很丑」。
//    0.8.0 把占位的边框也设成了透明，那个图标光秃秃地悬在三个带框按钮中间。
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = fs.readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')

/** 取某个选择器的规则体 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[[\]'.=*]/g, '\\$&')
  return new RegExp(`${escaped} \\{([^}]*)\\}`).exec(styles)?.[1] ?? ''
}

describe('0.8.2 the tile no longer looks empty at the top', () => {
  it('moves the icon and name up by shrinking the top padding', () => {
    const rule = ruleBody('.resource-tile')
    const padding = /padding:\s*([^;]+);/.exec(rule)?.[1]?.trim() ?? ''
    console.log('卡片内边距:', padding)
    // 顶部由 30px 收到 10px，图标与名称整体上移
    expect(padding).toBe('10px 6px 6px')
    // 不能再是那个「为按钮预留 30px」的旧值
    expect(padding).not.toContain('30px')
  })

  it('keeps the padding constant so the card never jumps', () => {
    // 悬停才改尺寸会让卡片在鼠标进出、拖拽经过时跳动
    // （那正是 0.7.7 修过的「卡片大小偶尔不一样」）。
    // 所以内边距只能有一个值，不能出现 :hover 覆盖
    const hoverRule = ruleBody('.resource-tile:hover')
    expect(hoverRule).not.toContain('padding')
    // 悬停只改颜色
    expect(hoverRule).toContain('background: transparent')
  })

  it('keeps top and bottom gaps close to each other', () => {
    // 上下留白要接近：10px vs 6px，差 4px。
    // 之前是 30.8px vs 4.8px，差 26px —— 那才是「顶部空缺一块」的观感来源
    const rule = ruleBody('.resource-tile')
    const padding = /padding:\s*([^;]+);/.exec(rule)?.[1] ?? ''
    const [top, , bottom] = padding
      .replace(';', '')
      .trim()
      .split(/\s+/)
      .map((value) => Number.parseFloat(value))
    console.log(`顶部 ${top}px / 底部 ${bottom}px`)
    expect(top).toBeDefined()
    expect(bottom).toBeDefined()
    expect(Math.abs(top! - bottom!), '上下留白差距不该超过 8px').toBeLessThanOrEqual(8)
  })

  it('still reserves the action row inside the card', () => {
    // 上移之后按钮仍必须落在卡片内（不能溢出到卡片外）
    const rule = ruleBody('.resource-tile')
    const top = Number.parseFloat(/padding:\s*([\d.]+)px/.exec(rule)?.[1] ?? '0')
    // 按钮 top:4px + 高 24px = 28px，卡片上内边距 10px，按钮底部仍在卡片内
    const actions = ruleBody('.resource-tile-actions')
    const actionTop = Number.parseFloat(/top:\s*([\d.]+)px/.exec(actions)?.[1] ?? '0')
    console.log(`按钮 top=${actionTop}px 高 24px，卡片上内边距 ${top}px`)
    expect(top).toBeLessThan(actionTop + 24)
  })

  it('keeps the action row clickable by waiting for the hover state', () => {
    /*
     * 0.8.2 排查「按钮点不动」的结论。
     *
     * 报错是 `<div class="resource-tile-preview"> intercepts pointer events`，
     * 一开始以为是层叠问题（图标上移后盖住了按钮）。实测否掉了这个猜测：
     *   - 未悬停时按钮行是 pointer-events: none，此刻该位置**本来就**属于预览区
     *   - 悬停生效后按钮行变成 auto，命中按钮本身
     *   - 加不加 z-index、padding 是 10px 还是 30px，都不改变这个结果
     *
     * 所以根因是「悬停态还没成立就点击」：测试用固定 waitForTimeout，
     * 而 Playwright 点击前会做命中检测，命中预览区就重试到超时。
     *
     * 这里守住两条不变量：按钮行未悬停时不可点、悬停后必须可点。
     */
    const actions = ruleBody('.resource-tile-actions')
    // 未悬停：不可点（免得看不见的按钮抢走点击）
    expect(actions).toContain('pointer-events: none')
    // 悬停 / 聚焦时：可点
    const hoverRule =
      /\.resource-tile:hover \.resource-tile-actions,[\s\S]*?\.resource-tile:focus-within \.resource-tile-actions \{([^}]*)\}/
        .exec(styles)?.[1] ?? ''
    expect(hoverRule, '应有悬停可点规则').toBeTruthy()
    expect(hoverRule).toContain('pointer-events: auto')
    expect(hoverRule).toContain('opacity: 1')
  })

  it('e2e waits for the hover state instead of a fixed sleep', () => {
    // 修法在测试侧：等 pointer-events 真的变成 auto 再点，
    // 而不是 hover() 之后固定 sleep（那正是超时的原因）
    const spec = fs.readFileSync(
      new URL('./e2e/resources-actions-080.spec.ts', import.meta.url),
      'utf8'
    )
    expect(spec, '应有等悬停态的辅助函数').toContain('async function hoverTileAndWait')
    expect(spec).toContain("getComputedStyle(actions).pointerEvents !== 'none'")
    // 点「笔」之前必须用这个辅助函数，不能再是 hover + 固定等待
    const beforePencil = /hoverTileAndWait\(window, tile\)[\s\S]{0,200}?修改 .* 的信息/.test(spec)
    expect(beforePencil, '点「笔」之前应先等悬停态').toBe(true)
  })
})

describe('0.8.2 the greyed-out placeholder keeps its frame', () => {
  it('keeps a visible border instead of a transparent one', () => {
    const rule = ruleBody('.resource-tile-actions .icon-button.is-placeholder')
    expect(rule, '应有占位样式').toBeTruthy()
    // 关键：边框用可见的线条色，而不是透明
    expect(rule).toContain('border-color: var(--line)')
    expect(rule).not.toContain('border-color: transparent')
  })

  it('drops the background but keeps the frame', () => {
    const rule = ruleBody('.resource-tile-actions .icon-button.is-placeholder')
    // 用户选择「只保留边框，不铺底色」
    expect(rule).toContain('background: transparent')
  })

  it('greys only the icon, not the whole button', () => {
    // 连边框一起变淡会显得外框也缺了一块，所以整体不降透明度，只让 svg 变淡
    const rule = ruleBody('.resource-tile-actions .icon-button.is-placeholder')
    expect(rule).toContain('opacity: 1')
    const svgRule = ruleBody('.resource-tile-actions .icon-button.is-placeholder svg')
    expect(svgRule, '图标本身应变淡').toContain('opacity')
    const svgOpacity = Number.parseFloat(/opacity:\s*([\d.]+)/.exec(svgRule)?.[1] ?? '1')
    expect(svgOpacity, '图标要看得见但明显更淡').toBeGreaterThan(0.2)
    expect(svgOpacity).toBeLessThan(0.7)
  })

  it('is still not clickable', () => {
    const rule = ruleBody('.resource-tile-actions .icon-button.is-placeholder')
    expect(rule).toContain('pointer-events: none')
    expect(rule).toContain('cursor: default')
  })

  it('keeps the same box as the real buttons so the row stays aligned', () => {
    // 四格对齐：占位与真实按钮共用 .icon-button 的尺寸
    const iconButton = ruleBody('.resource-tile-actions .icon-button')
    expect(iconButton).toContain('width: 100%')
    expect(iconButton).toContain('height: 24px')
  })
})
