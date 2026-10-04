export type Box = { x: number; y: number; width: number; height: number }

export type Shot = {
  id: string
  label: string
  duration: number
  before: string
  after?: string
  caption: string
  target: Box
  result?: Box
  zoom: number
  typing?: boolean
  query?: string
}

export const FPS = 60
export const WIDTH = 1920
export const HEIGHT = 1080
export const OPENING_DURATION = 480
export const OUTRO_DURATION = 840

export const SHOTS: Shot[] = [
  {
    id: 'records', label: '跑团记录总览', duration: 660,
    before: 'captures/records-overview.png',
    caption: '在跑团记录汇总中，统一查看所有模组、场次与处理状态。',
    target: { x: 249, y: 210, width: 1627, height: 405 }, zoom: 1.035
  },
  {
    id: 'module-search', label: '全模组正文搜索', duration: 840,
    before: 'captures/records-overview.png', after: 'captures/records-search.png',
    caption: '输入关键词，即可同时检索场次正文与导图节点。',
    target: { x: 1643, y: 277, width: 220, height: 30 },
    result: { x: 250, y: 315, width: 1625, height: 183 }, zoom: 1.22, typing: true, query: '领航员'
  },
  {
    id: 'preset', label: '选项预设', duration: 720,
    before: 'captures/records-overview.png', after: 'captures/preset-modal.png',
    caption: '通过选项预设，快速统一检测、下载与文档生成规则。',
    target: { x: 705, y: 155, width: 78, height: 32 },
    result: { x: 620, y: 391, width: 680, height: 298 }, zoom: 1.34
  },
  {
    id: 'record-detail', label: '场次记录详情', duration: 840,
    before: 'captures/records-overview.png', after: 'captures/record-detail.png',
    caption: '打开单场记录，按时间顺序查看完整跑团上下文。',
    target: { x: 314, y: 364, width: 231.1, height: 17 },
    result: { x: 620, y: 155, width: 680, height: 770 }, zoom: 1.24
  },
  {
    id: 'detail-search', label: '记录内搜索', duration: 900,
    before: 'captures/record-detail.png', after: 'captures/record-detail-search.png',
    caption: '在详情中搜索线索，匹配结果与原文位置同步呈现。',
    target: { x: 641, y: 280, width: 583, height: 35 },
    result: { x: 621, y: 210, width: 663, height: 420 }, zoom: 1.16, typing: true, query: '领航员'
  },
  {
    id: 'characters', label: '调查员角色卡', duration: 720,
    before: 'captures/characters-overview.png',
    caption: '调查员角色卡集中整理基础资料、属性与当前状态。',
    target: { x: 251, y: 149, width: 316.4, height: 216 }, zoom: 1.10
  },
  {
    id: 'character-editor', label: '角色卡编辑', duration: 900,
    before: 'captures/characters-overview.png', after: 'captures/character-editor.png',
    caption: '进入角色卡后，继续维护属性、技能、装备与背景信息。',
    target: { x: 251, y: 149, width: 316.4, height: 216 },
    result: { x: 510, y: 35, width: 900, height: 1010 }, zoom: 1.09
  },
  {
    id: 'resources', label: '资料汇总', duration: 720,
    before: 'captures/resources-overview.png',
    caption: '资料汇总把导图、链接与本地文件按模组集中管理。',
    target: { x: 264, y: 200, width: 105.8, height: 104.8 }, zoom: 1.25
  },
  {
    id: 'mindmap', label: '导图预览', duration: 960,
    before: 'captures/resources-overview.png', after: 'captures/mindmap-viewer.png',
    caption: '双击导图即可原比例预览，并继续搜索、缩放或切换页面。',
    target: { x: 264, y: 200, width: 105.8, height: 104.8 },
    result: { x: 18, y: 54, width: 872.9, height: 30 }, zoom: 1.25
  },
  {
    id: 'notes', label: '跑团闲记', duration: 720,
    before: 'captures/notes-overview.png',
    caption: '用跑团闲记保存备团要点、临场备注与相关图片。',
    target: { x: 249, y: 147, width: 317.2, height: 400 }, zoom: 1.08
  },
  {
    id: 'note-editor', label: '闲记编辑', duration: 840,
    before: 'captures/notes-overview.png', after: 'captures/note-editor.png',
    caption: '点击卡片即可编辑日期、归属模组、正文和图片附件。',
    target: { x: 249, y: 147, width: 317.2, height: 400 },
    result: { x: 249, y: 147, width: 648.4, height: 400 }, zoom: 1.08
  },
  {
    id: 'settings', label: '数据与设置', duration: 660,
    before: 'captures/settings-overview.png',
    caption: '数据与设置页面清晰汇总本地数据、界面与归档位置。',
    target: { x: 1078, y: 148, width: 812, height: 166 }, zoom: 1.045
  },
  {
    id: 'backup', label: '备份与恢复', duration: 720,
    before: 'captures/settings-overview.png', after: 'captures/backup-modal.png',
    caption: '导出备份时，可选择仅保存数据，或连同归档文件一起保存。',
    target: { x: 1098, y: 234, width: 80, height: 36 },
    result: { x: 620, y: 372, width: 680, height: 336 }, zoom: 1.32
  }
]

export const FEATURE_DURATION = SHOTS.reduce((sum, shot) => sum + shot.duration, 0)
export const TOTAL_FRAMES = OPENING_DURATION + FEATURE_DURATION + OUTRO_DURATION

export const SHOT_STARTS = SHOTS.reduce<Record<string, number>>((acc, shot, index) => {
  acc[shot.id] = OPENING_DURATION + SHOTS.slice(0, index).reduce((sum, item) => sum + item.duration, 0)
  return acc
}, {})

export const SFX_CUES = SHOTS.flatMap((shot) => {
  const start = SHOT_STARTS[shot.id]
  const click = start + (shot.typing ? 240 : 190)
  const cues = [
    { from: start + 118, src: 'audio/transition-soft.mp3', volume: 0.12 }
  ]
  if (shot.typing) {
    cues.push({ from: start + 155, src: 'audio/keyboard.mp3', volume: 0.10 })
  } else {
    cues.push({ from: click, src: 'audio/click.mp3', volume: 0.16 })
  }
  return cues
})
