// 0.8.0：资料汇总的四处交互调整
//
// 1) 拖拽时的底色块
//    用户反馈「拖拽资料仍有底色块，取决于鼠标抓取的位置：抓图标上没色块，
//    抓图标周边就有，色块宽度和黑底提示框一致」。
//    实测确认机制：dragstart 那一刻浏览器给拖拽源**截图**做「拖拽影像」，
//    提示框若正显示着会被一起拍进去——提示框实测 189px 宽、向上溢出卡片 35px，
//    而卡片只有 106px 宽，于是色块又宽又高，正好和提示框一样。
//    修法：dragstart 时**同步**收掉提示框（DOM 属性 + CSS，不能靠 setState），
//    并给正在拖的卡片加淡紫描边，让「从哪儿抓」的显示效果一致。
//
// 2) 新建链接资料时，链接地址不再预填 Notion 占位
// 3) 链接类资料没有本地文件，文件夹图标显示灰色且不可点（保留位置）
// 4) 「笔」图标改为修改资料信息（标题 / 归属模组 / 备注，链接类还能改地址）
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = fs.readFileSync(
  new URL('../src/renderer/src/components/ResourcesPage.tsx', import.meta.url),
  'utf8'
)
const styles = fs.readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')

describe('0.8.0 dragging shows a consistent outline, never a colour block', () => {
  it('hides the tooltip synchronously at dragstart', () => {
    // 必须同步：setState 是异步的，等 React 重渲染完浏览器早截完图了
    expect(page).toContain("document.body.setAttribute('data-dragging', 'true')")
    // 收提示框的规则由这个属性驱动
    expect(styles).toContain("body[data-dragging='true'] [data-tip]::after")
    expect(styles).toMatch(/body\[data-dragging='true'\] \[data-tip\]::after \{\s*\n\s*content: none/)
  })

  it('marks the dragged card so its outline is identical wherever you grab it', () => {
    // 卡片本身也打标记：CSS 据此给「正在拖的那张」加描边
    expect(page).toContain("setAttribute('data-dragging', 'true')")
    expect(page).toContain("removeAttribute('data-dragging')")
    expect(page).toContain('data-resource-id={resource.id}')
    // 描边样式存在，且不铺底色。
    // 0.8.1 起改用卡片自身的边框上色（形状/尺寸天然与卡片一致，不会「小一圈」）
    const rule = /body\[data-dragging='true'\] \.resource-tile\[data-dragging='true'\] \{([^}]*)\}/.exec(
      styles
    )?.[1]
    expect(rule, '应有「正在拖的卡片」描边规则').toBeDefined()
    expect(rule!).toContain('border-color: var(--accent)')
    expect(rule!).toContain('background: transparent')
  })

  it('clears the drag marker on dragend', () => {
    // 不清掉的话，拖完一次之后提示框就再也不显示了
    const end = /onDragEnd=\{\(event\) => \{([\s\S]*?)\n {8}\}\}/.exec(page)?.[1]
    expect(end, '应能找到 onDragEnd').toBeDefined()
    expect(end!).toContain("document.body.removeAttribute('data-dragging')")
    expect(end!).toContain("removeAttribute('data-dragging')")
  })

  it('keeps the drop target outlined rather than filled', () => {
    const rule = /\.resource-group\.drop-target \{([^}]*)\}/.exec(styles)?.[1]
    expect(rule).toBeDefined()
    expect(rule!).toContain('background: transparent')
    // 0.8.1：线宽收到 1px，与被拖卡片的描边同宽
    expect(rule!).toContain('box-shadow: inset 0 0 0 1px var(--accent)')
  })

  it('uses inset outline instead of a border so nothing shifts', () => {
    // 加边框会改变盒模型，卡片/分组会在拖动时跳动
    for (const selector of ['.resource-group.drop-target', 'body[data-dragging=\'true\'] .resource-tile[data-dragging=\'true\']']) {
      const rule = new RegExp(`${selector.replace(/[[\]'.=]/g, '\\$&')} \\{([^}]*)\\}`).exec(styles)?.[1] ?? ''
      expect(rule, `${selector} 不该用 border 加粗`).not.toMatch(/border:\s*\d+px/)
    }
  })
})

describe('0.8.0 new link no longer pre-fills a Notion placeholder', () => {
  it('leaves the url placeholder empty', () => {
    // 用户要求「链接地址不要默认为 Notion，留空就好，让用户自行编辑」
    expect(page).not.toContain('https://www.notion.so/...')
    // 添加链接那个输入框的 placeholder 必须是空串
    const addForm = /draft\.kind === 'link' \? \(([\s\S]*?)\n {10}\) : \(/.exec(page)?.[1]
    expect(addForm, '应能找到「添加链接」的表单').toBeDefined()
    expect(addForm!).toMatch(/placeholder=""/)
  })
})

describe('0.8.0 link resources get a greyed-out folder icon', () => {
  it('renders the folder icon as a non-clickable placeholder', () => {
    // 保留图标（四格不错位），但用 span 而不是 button → 点不了
    expect(page).toMatch(/is-placeholder[\s\S]{0,120}<FolderIcon \/>/)
    // 占位不再是全透明空 span
    expect(page).not.toMatch(/is-placeholder" aria-hidden="true" \/>/)
  })

  it('greys it out and blocks pointer events', () => {
    const rule = /\.resource-tile-actions \.icon-button\.is-placeholder \{([^}]*)\}/.exec(styles)?.[1]
    expect(rule, '应有置灰规则').toBeDefined()
    expect(rule!).toContain('pointer-events: none')
    expect(rule!).toContain('cursor: default')
    /*
     * 变灰的方式（0.8.2）。
     *
     * 0.8.0 用整体 opacity 0.38 变淡，但那样连**边框**一起淡掉了，
     * 图标光秃秃地悬在三个带框按钮中间很突兀。
     * 0.8.2 改成保留边框（border-color: var(--line)）、只让里面的 svg 变淡。
     */
    expect(rule!).toContain('border-color: var(--line)')
    expect(rule!).toContain('opacity: 1')
    const svgRule = /\.resource-tile-actions \.icon-button\.is-placeholder svg \{([^}]*)\}/.exec(
      styles
    )?.[1]
    expect(svgRule, '图标本身应变淡').toMatch(/opacity:\s*0?\.\d+/)
  })
})

describe('0.8.0 the pencil icon edits resource info', () => {
  it('opens an editor instead of launching the original app', () => {
    // 「笔」不再调 openInOriginalApp
    const pencil = /aria-label=\{`修改 \$\{label\} 的信息`\}([\s\S]{0,220}?)<\/button>/.exec(page)?.[1]
    expect(pencil, '应能找到笔按钮').toBeDefined()
    expect(pencil!).toContain('openEditor(resource)')
    expect(pencil!).not.toContain('openInOriginalApp')
  })

  it('still lets the user open the original app by double-clicking', () => {
    // 功能不能丢：双击卡片仍然用原程序打开
    expect(page).toMatch(/onDoubleClick=\{\(\) => void openResource\(resource\)\}/)
  })

  it('edits title, module and note', () => {
    expect(page).toContain('修改资料信息')
    const dialog = /title="修改资料信息"[\s\S]*?\n {6}\)\}/.exec(page)?.[0] ?? ''
    expect(dialog).toContain('标题')
    expect(dialog).toContain('归属模组')
    expect(dialog).toContain('备注')
    expect(dialog).toContain('<SelectField')
  })

  it('also edits the url for links and the file for files', () => {
    const dialog = /title="修改资料信息"[\s\S]*?\n {6}\)\}/.exec(page)?.[0] ?? ''
    // 链接类改地址
    expect(dialog).toContain('链接地址')
    expect(dialog).toContain('editor.url')
    // 文件类重新指定
    expect(dialog).toContain('重新指定')
    expect(dialog).toContain('pickEditorFile')
  })

  it('saves through update + setModule and refreshes', () => {
    const save = /const saveEditor = async \(\): Promise<void> => \{([\s\S]*?)\n {2}\}/.exec(page)?.[1]
    expect(save, '应能找到 saveEditor').toBeDefined()
    expect(save!).toContain('window.coc.resources.update(')
    expect(save!).toContain('window.coc.resources.setModule(')
    expect(save!).toContain('await onChanged()')
    // 链接类必须有地址
    expect(save!).toContain("editor.kind === 'link' && !editor.url.trim()")
  })

  it('refuses to save an empty link address', () => {
    const save = /const saveEditor = async \(\): Promise<void> => \{([\s\S]*?)\n {2}\}/.exec(page)?.[1] ?? ''
    expect(save).toContain("onNotice('请填写链接地址')")
    expect(save).toContain('return')
  })
})
