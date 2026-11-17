import { expect, it } from 'vitest'
import { previewBackup, validateSnapshotValue } from './backup'
import { exampleBackup } from './fixtures'

it('已解码 JSON 与字节入口逐项接受或拒绝相同结构、全文、关联及来源', async () => {
  const changes: Array<(value: any) => void> = [
    () => {},
    (value) => {
      value.schemaVersion = 99
    },
    (value) => {
      value.modules.push(value.modules[0])
    },
    (value) => {
      value.records[0].moduleId = 'missing-public-module'
    },
    (value) => {
      value.records[0].rawContent.parserVersion = '1'
    },
    (value) => {
      value.records[0].rawContent.messages[0].order = null
    },
    (value) => {
      value.records[0].rawContent.messages[0].isOffTopic = 1
    },
    (value) => {
      value.records[0].rawContent.messages[0].images = [{ url: 123 }]
    },
    (value) => {
      value.records[0].rawContent.sourceUrl = 'https://public.invalid/wrong'
    },
    (value) => {
      value.records[0].cacheSourceUrl = 'https://public.invalid/wrong'
    },
    (value) => {
      value.records[0].rawContent.messages[0].raw = {
        nested: [null, true, 42, '中文😀\\"\n'],
        arbitrary: { full: '正文'.repeat(60000) }
      }
    },
    (value) => {
      value.settings.autoBackup = { enabled: true, interval: 'weekly', retention: 20 }
    }
  ]
  for (const change of changes) {
    const source = exampleBackup()
    change(source)
    const json = JSON.stringify(source)
    const old = await previewBackup(new TextEncoder().encode(json)).then(
      (value) => ({ value }),
      (error) => ({ error: error.message })
    )
    const next = await validateSnapshotValue(JSON.parse(json)).then(
      (value) => ({ value }),
      (error) => ({ error: error.message })
    )
    expect(next).toEqual(old)
  }
})
