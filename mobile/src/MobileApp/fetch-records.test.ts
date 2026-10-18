import { expect, it } from 'vitest'
import { fetchRecords } from './fetch-records'
import { exampleBackup } from '../data/fixtures'
import { previewBackup } from '../data/backup'
import type { FetchProgress } from './fetch-records'

it('五场公开样本对照 2／3／4 路：有界、顺序稳定、完整正文、进度真实且输入不变', async () => {
  const base = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
    .records[0]!
  const records = Array.from({ length: 5 }, (_, i) => ({
    ...base,
    id: 'public-' + i,
    link: 'https://log.weizaima.com/?key=public-' + i
  }))
  const before = JSON.stringify(records)
  for (const concurrency of [2, 3, 4] as const) {
    const timings: number[] = []
    for (let repeat = 0; repeat < 3; repeat++) {
      let active = 0
      let peak = 0
      const progress: FetchProgress[] = []
      const start = performance.now()
      const result = await fetchRecords(
        {
          async fetchLog({ url }) {
            active++
            peak = Math.max(peak, active)
            await new Promise((resolve) => setTimeout(resolve, 200))
            active--
            const key = new URL(url).searchParams.get('key')
            return {
              status: 200,
              url,
              text: JSON.stringify({ messages: [{ nickname: '公开主持人', content: '完整正文 ' + key }] })
            }
          }
        },
        records,
        { concurrency, onProgress: (value) => progress.push(value) }
      )
      timings.push(Math.round(performance.now() - start))
      expect(peak).toBe(concurrency)
      expect(result.map((item) => item.id)).toEqual([
        'public-0',
        'public-1',
        'public-2',
        'public-3',
        'public-4'
      ])
      expect(result.map((item) => item.rawContent?.messages[0]?.text)).toEqual([
        '完整正文 public-0',
        '完整正文 public-1',
        '完整正文 public-2',
        '完整正文 public-3',
        '完整正文 public-4'
      ])
      expect(progress.map((value) => value.completed)).toEqual([0, 1, 2, 3, 4, 5])
      expect(progress.at(-1)).toEqual({ completed: 5, total: 5, succeeded: 5, failed: 0 })
      expect(JSON.stringify(records)).toBe(before)
    }
    console.log(
      JSON.stringify({
        environment: 'Node public fixture, 200ms simulated HTTP, not S9 or real server',
        concurrency,
        records: 5,
        timings
      })
    )
  }
}, 10000)
