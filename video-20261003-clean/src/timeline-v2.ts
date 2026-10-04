export type Box = { x: number; y: number; width: number; height: number }

export type ActionKind = 'click' | 'double-click' | 'type' | 'hover' | 'scroll' | 'progress' | 'hold'

export type ActionStep = {
  from: string
  to: string
  duration: number
  target: Box
  focus?: Box
  caption: string
  kind?: ActionKind
  query?: string
  redact?: Box
  redactText?: string
  status?: string
}

export type ActionShot = {
  id: string
  label: string
  actions: ActionStep[]
}

const v2 = (name: string): string => `captures-v2/${name}.png`
const old = (name: string): string => `captures/${name}.png`
const b = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height })

export const FPS = 60
export const WIDTH = 1920
export const HEIGHT = 1080
export const OPENING_DURATION = 210
export const OUTRO_DURATION = 270

const BASE_SHOTS: ActionShot[] = [
  {
    id: 'module-lifecycle', label: '模组管理', actions: [
      { from: v2('01-records-home'), to: v2('02-module-create-open'), duration: 108, target: b(1799, 60, 92, 36), caption: '点击新建模组，建立一套新的跑团档案。' },
      { from: v2('02-module-create-open'), to: v2('03-module-create-filled'), duration: 180, target: b(641, 441, 312, 34), focus: b(620, 331, 680, 419), caption: '填写模组名称、跑团状态与守密人信息。', kind: 'type', query: '演示模组：钟塔' },
      { from: v2('03-module-create-filled'), to: v2('04-module-created'), duration: 110, target: b(1193, 701, 86, 34), caption: '保存后，模组立即加入记录列表。' },
      { from: v2('04-module-created'), to: v2('05-module-edit-open'), duration: 108, target: b(301, 890, 98, 20), focus: b(249, 842, 1627, 126), caption: '点击已有模组名称，可随时重新编辑。' },
      { from: v2('05-module-edit-open'), to: v2('06-module-edit-status'), duration: 108, target: b(1179, 440, 100, 34), focus: b(968, 415, 311, 84), caption: '修改跑团状态，让当前进度一目了然。' },
      { from: v2('06-module-edit-status'), to: v2('06b-module-edited'), duration: 108, target: b(1193, 701, 86, 34), caption: '保存修改后，列表状态同步更新。' },
      { from: v2('06b-module-edited'), to: v2('07-module-delete-confirm'), duration: 108, target: b(1833, 885, 30, 30), caption: '不再需要的模组，可从列表发起删除。' },
      { from: v2('07-module-delete-confirm'), to: v2('08-module-deleted'), duration: 110, target: b(1103, 585, 86, 34), focus: b(710, 446, 500, 189), caption: '确认删除后，相关模组从汇总中移除。' },
    ]
  },
  {
    id: 'import', label: '导入表格', actions: [
      { from: v2('01-records-home'), to: v2('09-import-open'), duration: 108, target: b(260, 155, 77, 32), caption: '导入表格，快速建立已有模组与场次数据。' },
      { from: v2('09-import-open'), to: v2('10-import-done'), duration: 145, target: b(887, 645, 170, 34), focus: b(530, 319, 860, 443), caption: '选择表格后，立即查看导入结果与统计。' },
    ]
  },
  {
    id: 'export', label: '导出表格', actions: [
      { from: v2('01-records-home'), to: v2('11-export-open'), duration: 105, target: b(345, 155, 79, 32), caption: '导出表格时，可选择需要的数据范围。' },
      { from: v2('11-export-open'), to: v2('12-export-format'), duration: 105, target: b(641, 511, 100, 44), focus: b(620, 340, 680, 401), caption: '按用途选择 CSV 或 XLSX 格式。' },
      { from: v2('12-export-format'), to: v2('13-export-done'), duration: 108, target: b(745, 623, 87, 34), caption: '执行导出后，完成结果即时反馈。', status: '导出完成' },
    ]
  },
  {
    id: 'batch-check', label: '批量检测', actions: [
      { from: v2('01-records-home'), to: v2('14-check-open'), duration: 105, target: b(447, 155, 80, 32), caption: '批量检测可一次检查整组场次链接。' },
      { from: v2('14-check-open'), to: v2('15-check-selected'), duration: 105, target: b(562, 503, 15, 15), focus: b(551, 491, 818, 42), caption: '勾选目标模组，确认需要检测的场次。' },
      { from: v2('15-check-selected'), to: v2('16-check-running'), duration: 105, target: b(1283, 678, 86, 34), caption: '开始检测后，逐条显示处理进度。' },
      { from: v2('16-check-running'), to: v2('17-check-done'), duration: 165, target: b(960, 540, 240, 80), focus: b(530, 250, 860, 580), caption: '检测完成后，结果与异常原因集中呈现。', kind: 'progress' },
    ]
  },
  {
    id: 'batch-download', label: '批量下载', actions: [
      { from: v2('01-records-home'), to: v2('17b-record-selected'), duration: 105, target: b(269, 371, 16, 16), caption: '先勾选需要处理的场次。' },
      { from: v2('17b-record-selected'), to: v2('18-download-open'), duration: 105, target: b(531, 155, 88, 32), caption: '点击批量下载，统一选择输出格式。' },
      { from: v2('18-download-open'), to: v2('19-download-format'), duration: 105, target: b(1120, 518, 86, 34), focus: b(620, 400, 680, 280), caption: '选择 TXT、DOCX、PDF 等目标格式。', kind: 'hover' },
      { from: v2('19-download-format'), to: v2('20-download-done'), duration: 108, target: b(1120, 518, 86, 34), caption: '点击目标格式，一次生成全部所选场次文件。', status: '批量下载完成 · 已生成 1 个文件' },
    ]
  },
  {
    id: 'batch-combine', label: '批量合成', actions: [
      { from: v2('17b-record-selected'), to: v2('21-combine-open'), duration: 105, target: b(621, 155, 84, 32), caption: '批量合成可把多个场次整理为一份文档。' },
      { from: v2('21-combine-open'), to: v2('22-combine-format'), duration: 105, target: b(844, 540, 85, 34), focus: b(620, 422, 680, 236), caption: '选择合成格式，保持输出结构统一。', kind: 'hover' },
      { from: v2('22-combine-format'), to: v2('23-combine-done'), duration: 108, target: b(844, 540, 85, 34), caption: '确认后生成完整合并文档。', status: '合并文档已生成' },
    ]
  },
  {
    id: 'preset', label: '选项预设', actions: [
      { from: v2('01-records-home'), to: v2('24-preset-open'), duration: 105, target: b(705, 155, 78, 32), caption: '打开选项预设，统一处理规则。' },
      { from: v2('24-preset-open'), to: v2('25-preset-first-toggled'), duration: 110, target: b(641, 477, 319, 42), focus: b(641, 477, 319, 42), caption: '先开启骰子指令过滤。' },
      { from: v2('25-preset-first-toggled'), to: v2('25b-preset-second-toggled'), duration: 110, target: b(961, 477, 318, 42), focus: b(961, 477, 318, 42), caption: '再独立开启表情图片过滤，每次只切换一个选项。' },
      { from: v2('25b-preset-second-toggled'), to: v2('26-preset-saved'), duration: 108, target: b(1193, 640, 86, 34), caption: '保存预设，后续检测与文档生成直接复用。' },
    ]
  },
  {
    id: 'module-search', label: '正文搜索与跳转', actions: [
      { from: v2('01-records-home'), to: v2('27-module-search-results'), duration: 165, target: b(1643, 277, 220, 30), focus: b(1588, 254, 275, 76), caption: '输入关键词，同时检索场次正文与导图节点。', kind: 'type', query: '领航员' },
      { from: v2('27-module-search-results'), to: v2('28-module-search-jump'), duration: 115, target: b(300, 364, 1525, 57), focus: b(280, 340, 1565, 105), caption: '点击正文命中，直接跳转到对应场次位置。' },
    ]
  },
  {
    id: 'detail-search', label: '详情内搜索', actions: [
      { from: v2('28b-detail-search-ready'), to: v2('29-detail-search-results'), duration: 160, target: b(641, 280, 583, 35), focus: b(620, 264, 680, 70), caption: '在场次详情中继续输入线索关键词。', kind: 'type', query: '旧纸张' },
      { from: v2('29-detail-search-results'), to: v2('30-detail-search-jump'), duration: 112, target: b(641, 257, 613, 57), focus: b(620, 210, 680, 260), caption: '点击匹配项，原文位置同步高亮并跳转。' },
    ]
  },
  {
    id: 'characters', label: '调查员角色卡', actions: [
      { from: v2('31-characters-overview'), to: v2('32-character-editor-top'), duration: 112, target: b(251, 149, 316, 216), caption: '从角色卡总览直接进入调查员资料。' },
      { from: v2('32-character-editor-top'), to: v2('33-character-editor-mid'), duration: 125, target: b(1380, 560, 18, 180), focus: b(510, 35, 900, 1010), caption: '向下滚动，继续查看武器、技能与装备。', kind: 'scroll' },
      { from: v2('33-character-editor-mid'), to: v2('34-character-editor-bottom'), duration: 125, target: b(1380, 840, 18, 150), focus: b(510, 35, 900, 1010), caption: '完整浏览背景信息，并随时保存修改。', kind: 'scroll' },
    ]
  },
  {
    id: 'resources', label: '资料管理', actions: [
      { from: v2('35-resources-overview'), to: v2('35-resources-overview'), duration: 120, target: b(249, 147, 1627, 892), caption: '资料汇总集中管理导图、链接与文件，并按模组归档。', kind: 'hold' },
      { from: v2('35-resources-overview'), to: v2('36-resource-actions'), duration: 100, target: b(264, 200, 106, 105), caption: '悬停资料卡，即可展开四项快捷操作。', kind: 'hover' },
      { from: v2('36-resource-actions'), to: v2('37-resource-edit'), duration: 108, target: b(293, 205, 24, 24), focus: b(264, 200, 106, 105), caption: '点击编辑，维护标题、归属与资料信息。' },
      { from: v2('37-resource-edit'), to: v2('36-resource-actions'), duration: 100, target: b(1264, 354, 30, 30), focus: b(620, 339, 680, 403), caption: '关闭编辑后，快捷操作仍保持清晰可见。' },
      { from: v2('36-resource-actions'), to: v2('38-resource-delete-confirm'), duration: 110, target: b(342, 205, 24, 24), focus: b(264, 200, 106, 105), caption: '删除资料前会再次确认，避免误操作。' },
    ]
  },
  {
    id: 'mindmap', label: '导图搜索与跳转', actions: [
      { from: v2('35-resources-overview'), to: v2('39-mindmap-open'), duration: 125, target: b(264, 200, 106, 105), caption: '双击导图，按原比例进入完整预览。', kind: 'double-click' },
      { from: v2('39-mindmap-open'), to: v2('40-mindmap-search-results'), duration: 160, target: b(18, 54, 873, 30), focus: b(10, 45, 940, 90), caption: '输入关键词，列出导图内的全部匹配节点。', kind: 'type', query: '领航员' },
      { from: v2('40-mindmap-search-results'), to: v2('41-mindmap-search-jump'), duration: 112, target: b(116, 94, 130, 25), focus: b(10, 48, 960, 100), caption: '点击不同命中，画布立即跳转并高亮节点。' },
    ]
  },
  {
    id: 'notes', label: '跑团闲记', actions: [
      { from: old('notes-overview'), to: old('note-editor'), duration: 135, target: b(249, 147, 317, 400), caption: '跑团闲记集中保存备团要点、正文与图片附件。' },
    ]
  },
  {
    id: 'settings', label: '数据与设置', actions: [
      { from: old('settings-overview'), to: old('backup-modal'), duration: 145, target: b(1098, 234, 80, 36), focus: b(1078, 148, 812, 166), caption: '在数据与设置中管理归档位置、备份与恢复。', redact: b(1098, 385, 772, 38), redactText: '已配置归档位置' },
    ]
  },
]

// The previous cut was too compressed. Stretch every functional action by 12%
// while retaining the 3.5-second brand opening and 4.5-second outro. With the
// added resources overview beat this lands at roughly 1:45.
export const SHOTS: ActionShot[] = BASE_SHOTS.map((shot) => ({
  ...shot,
  actions: shot.actions.map((action) => ({ ...action, duration: Math.round(action.duration * 1.12) })),
}))

export const SHOT_DURATIONS = Object.fromEntries(SHOTS.map((shot) => [shot.id, shot.actions.reduce((sum, action) => sum + action.duration, 0)]))
export const FEATURE_DURATION = SHOTS.reduce((sum, shot) => sum + SHOT_DURATIONS[shot.id], 0)
export const TOTAL_FRAMES = OPENING_DURATION + FEATURE_DURATION + OUTRO_DURATION

export const SHOT_STARTS = SHOTS.reduce<Record<string, number>>((acc, shot, index) => {
  acc[shot.id] = OPENING_DURATION + SHOTS.slice(0, index).reduce((sum, item) => sum + SHOT_DURATIONS[item.id], 0)
  return acc
}, {})

export type SfxCue = { from: number; src: string; volume: number; duration: number }
export const SFX_CUES: SfxCue[] = SHOTS.flatMap((shot) => {
  let local = 0
  return shot.actions.flatMap((action) => {
    const actionStart = SHOT_STARTS[shot.id] + local
    local += action.duration
    if (action.kind === 'type') return [
      { from: actionStart + 38, src: 'audio/keyboard.mp3', volume: 0.08, duration: Math.min(90, action.duration - 70) },
    ]
    if (action.kind === 'scroll' || action.kind === 'progress') return [
      { from: actionStart + 30, src: 'audio/transition-soft.mp3', volume: 0.11, duration: 75 },
    ]
    return []
  })
})
