import type { MobileSnapshot } from '../data/types'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'

/** Public fictional data, bundled only in the browser development entry. */
export function searchSample(): MobileSnapshot {
  const date = '2026-10-13T00:00:00.000Z'
  const modules = ['雾港调查（公开测试）', '山间旅馆（公开测试）'].map((name, i) => ({
    id: `demo-module-${i}`,
    name,
    playStatus: 'running' as const,
    kps: ['示例主持人'],
    pairs: [],
    order: i,
    collapsed: false,
    createdAt: date,
    updatedAt: date
  }))
  const base = {
    sequenceNo: 1,
    dateSource: 'manual' as const,
    playDate: '2026-10-13',
    createdAt: date,
    updatedAt: date
  }
  return {
    schemaVersion: 2,
    exportedAt: date,
    modules,
    characters: [],
    settings: { theme: 'light', filterPreset: { ...DEFAULT_FILTER_PRESET } },
    records: [
      {
        ...base,
        id: 'demo-long',
        moduleId: modules[0]!.id,
        name: '第一场：灯塔线索（240条）',
        order: 0,
        sourceType: 'online',
        status: 'valid',
        link: 'https://example.invalid/public-log',
        rawContent: {
          parserVersion: 1,
          sourceUrl: 'https://example.invalid/public-log',
          messages: Array.from({ length: 240 }, (_, i) => ({
            id: `demo-message-${i}`,
            order: i,
            displayName: i % 2 ? '调查员林' : '示例主持人',
            timestamp: date,
            type: 'text',
            images: [],
            isDiceCommand: i === 20,
            isOffTopic: i === 30,
            text: [4, 104, 204].includes(i)
              ? `第${i + 1}条：在灯塔附近发现铜钥匙。灯塔的大门仍然紧闭。`
              : i === 20
                ? '.ra 侦查 骰子专用词'
                : i === 30
                  ? '（休息一下，题外专用词）'
                  : i === 45
                    ? '字面符号测试：a+b [线索] <script>不会执行</script>'
                    : `第${i + 1}条：调查员检查港口第${i + 1}处位置，记录脚印和潮水的方向。`
          }))
        }
      },
      {
        ...base,
        id: 'demo-manual',
        moduleId: modules[0]!.id,
        name: '第二场：手动调查笔记',
        order: 1,
        sourceType: 'manual',
        status: 'manual',
        manualContent:
          '在旅馆找到铜钥匙。\n\n窗边有一封信，提醒我们前往灯塔。\n返回旅馆后，再次核对铜钥匙的编号。'
      },
      {
        ...base,
        id: 'demo-other',
        moduleId: modules[1]!.id,
        name: '第三场：旅馆访谈',
        order: 2,
        sourceType: 'manual',
        status: 'manual',
        manualContent: '店主说昨晚有人经过旅馆。\n调查员决定沿山路继续调查。'
      },
      {
        ...base,
        id: 'demo-missing',
        moduleId: modules[1]!.id,
        name: '第四场：尚无正文',
        order: 3,
        sourceType: 'online',
        status: 'pending',
        link: 'https://example.invalid/not-fetched'
      }
    ]
  }
}
