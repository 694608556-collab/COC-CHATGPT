import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { FileService } from '../../src/main/file-service'
import { AppRepository } from '../../src/main/repository'
import { SeaLogService, type FetchLike } from '../../src/main/sea-log-service'

let database: AppDatabase
let repository: AppRepository
let directory: string

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://dice-api.weizaima.com/dice/api/load_data',
    json: async () => payload
  } as unknown as Response
}

function packedSeaPayload(name: string, items: unknown[]): unknown {
  const packed = zlib.deflateSync(Buffer.from(JSON.stringify({ name, items }), 'utf8'))
  return { data: packed.toString('base64') }
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-files-'))
  database = new AppDatabase(path.join(directory, 'data', 'coc.sqlite'))
  database.initialize()
  repository = new AppRepository(database, path.join(directory, 'archive'))
})

afterEach(() => database.close())

describe('safe local export', () => {
  it('exports UTF-8 text, sanitizes names, avoids overwriting and registers each real file', async () => {
    const module = repository.createModule({ name: '暗影:循迹?' })
    const record = repository.createRecord({
      moduleId: module.id,
      name: '第一/场',
      manualContent: '中文正文'
    })
    const service = new FileService(repository, async () => Buffer.from('%PDF-test'))
    const first = await service.exportRecord(record.id, 'txt')
    const second = await service.exportRecord(record.id, 'txt')
    expect(fs.readFileSync(first.path, 'utf8')).toContain('中文正文')
    expect(path.basename(first.path)).toBe('日期未知暗影＿循迹＿第一＿场.txt')
    expect(path.basename(second.path)).toBe('日期未知暗影＿循迹＿第一＿场 (2).txt')
    expect(repository.archiveEntriesFor('record', record.id)).toHaveLength(2)
  })

  it('creates DOCX locally and registers its hash only after success', async () => {
    const module = repository.createModule({ name: '模组' })
    const record = repository.createRecord({ moduleId: module.id, manualContent: '正文' })
    const entry = await new FileService(repository, async () => Buffer.from('%PDF-test')).exportRecord(
      record.id,
      'docx'
    )
    expect(fs.readFileSync(entry.path).subarray(0, 2).toString()).toBe('PK')
    expect(entry.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('removes invalid temporary PDF output and does not register it', async () => {
    const module = repository.createModule({ name: '模组' })
    const record = repository.createRecord({ moduleId: module.id, manualContent: '正文' })
    const service = new FileService(repository, async () => Buffer.from('broken'))
    await expect(service.exportRecord(record.id, 'pdf')).rejects.toThrow('文件生成失败')
    expect(repository.archiveEntriesFor()).toHaveLength(0)
    expect(fs.readdirSync(path.join(directory, 'archive', '模组'))).toHaveLength(0)
  })

  it('combines only one module in current order and reports unusable sessions', async () => {
    const module = repository.createModule({ name: '长团' })
    const other = repository.createModule({ name: '另一个模组' })
    const first = repository.createRecord({ moduleId: module.id, name: '第一场', manualContent: '内容一' })
    const missing = repository.createRecord({
      moduleId: module.id,
      name: '第二场',
      link: 'https://log.weizaima.com/?key=missing'
    })
    const third = repository.createRecord({ moduleId: module.id, name: '第三场', manualContent: '内容三' })
    repository.moveRecord(third.id, -1)
    repository.moveRecord(third.id, -1)
    const otherRecord = repository.createRecord({ moduleId: other.id, manualContent: '其他' })
    const service = new FileService(repository, async () => Buffer.from('%PDF-test'))
    await expect(service.exportCombined([first.id, otherRecord.id], 'txt')).rejects.toThrow('同一个模组')
    const result = await service.exportCombined([first.id, missing.id, third.id], 'txt')
    const text = fs.readFileSync(result.entry.path, 'utf8')
    expect(text.indexOf('第三场')).toBeLessThan(
      text.indexOf('第二场') < 0 ? Number.MAX_SAFE_INTEGER : text.indexOf('第二场')
    )
    expect(text.indexOf('第三场')).toBeLessThan(text.indexOf('第一场'))
    expect(result.included).toEqual([third.id, first.id])
    expect(result.failed).toEqual([{ id: missing.id, reason: '尚无可导出的正文，请先检测链接。' }])
  })

  it('exports probed SeaLog content through filters, formats, batch export and combined output', async () => {
    const module = repository.createModule({ name: '\u6d77\u8c79\u957f\u56e2' })
    repository.updateSettings({
      filterPreset: {
        hideDiceCommands: true,
        hideImages: true,
        hideOffTopic: true,
        hideTime: false,
        hidePlatformAccount: true,
        hideYearMonthDay: true,
        indentFirstLine: true,
        darkDisplay: true
      }
    })
    const first = repository.createRecord({
      moduleId: module.id,
      name: '\u7b2c\u4e00\u573a',
      link: 'http://log.weizaima.com/?key=one#111111'
    })
    const second = repository.createRecord({
      moduleId: module.id,
      name: '\u7b2c\u4e8c\u573a',
      link: 'http://log.weizaima.com/?key=two#222222'
    })
    const fetcher: FetchLike = async (input) => {
      const key = new URL(String(input)).searchParams.get('key')
      if (key === 'one')
        return response(
          200,
          packedSeaPayload('\u7b2c\u4e00\u573a\u65e5\u5fd7', [
            {
              id: 'm1',
              nickname: 'KP',
              uid: 'seal-account',
              time: '2025-03-08 19:30:00',
              content: '\u8c03\u67e5\u5f00\u59cb',
              images: ['https://example.com/handout.png']
            },
            { id: 'm2', nickname: '\u9ab0\u5b50', time: '2025-03-08 19:31:00', content: '.r\u4fa6\u67e5' },
            { id: 'm3', nickname: 'PL', time: '2025-03-08 19:32:00', content: '(ooc) \u6211\u53bb\u5012\u6c34' }
          ])
        )
      return response(
        200,
        packedSeaPayload('\u7b2c\u4e8c\u573a\u65e5\u5fd7', [
          {
            id: 'm4',
            nickname: 'PC',
            uid: 'hidden-user',
            time: '2025-03-09 20:00:00',
            content: '\u7b2c\u4e8c\u573a\u4fdd\u7559\u6b63\u6587'
          }
        ])
      )
    }
    const sea = new SeaLogService(repository, path.join(directory, 'cache'), fetcher)

    expect((await sea.probe(first.id)).status).toBe('valid')
    expect((await sea.probe(second.id)).status).toBe('valid')
    expect(fs.existsSync(path.join(directory, 'cache', 'records', first.id, 'raw.json'))).toBe(true)

    const pdfInputs: string[] = []
    const service = new FileService(repository, async (html) => {
      pdfInputs.push(html)
      return Buffer.from('%PDF-test')
    })
    const txt = await service.exportRecord(first.id, 'txt')
    const text = fs.readFileSync(txt.path, 'utf8')
    expect(text).toContain('19:30 KP')
    expect(text).toContain('\u3000\u3000\u8c03\u67e5\u5f00\u59cb')
    expect(text).not.toContain('2025-03-08')
    expect(text).not.toContain('seal-account')
    expect(text).not.toContain('.r\u4fa6\u67e5')
    expect(text).not.toContain('\u5012\u6c34')
    expect(text).not.toContain('[\u56fe\u7247]')
    expect(text).not.toContain('https://example.com/handout.png')

    const docx = await service.exportRecord(first.id, 'docx')
    expect(fs.readFileSync(docx.path).subarray(0, 2).toString()).toBe('PK')
    const pdf = await service.exportRecord(first.id, 'pdf')
    expect(pdf.format).toBe('pdf')
    let html = pdfInputs[pdfInputs.length - 1] ?? ''
    expect(html).toContain('class="dark"')
    expect(html).toContain('\u8c03\u67e5\u5f00\u59cb')
    expect(html).not.toContain('seal-account')
    expect(html).not.toContain('.r\u4fa6\u67e5')
    expect(html).not.toContain('https://example.com/handout.png')

    const batch = await service.batchExport([first.id, second.id], 'txt')
    expect(batch.state).toBe('completed')
    expect(batch.results.map((item) => item.state)).toEqual(['success', 'success'])

    const combined = await service.exportCombined([first.id, second.id], 'txt')
    const combinedText = fs.readFileSync(combined.entry.path, 'utf8')
    expect(combined.included).toEqual([first.id, second.id])
    expect(combinedText).toContain('\u7b2c\u4e00\u573a')
    expect(combinedText).toContain('\u7b2c\u4e8c\u573a\u4fdd\u7559\u6b63\u6587')
    expect(combinedText).not.toContain('.r\u4fa6\u67e5')
    expect(combinedText).not.toContain('hidden-user')
    await service.exportCombined([first.id, second.id], 'pdf')
    html = pdfInputs[pdfInputs.length - 1] ?? ''
    expect(html).toContain('\u7b2c\u4e8c\u573a\u4fdd\u7559\u6b63\u6587')
    expect(html).toContain('class="dark"')
  })

  it('generates all six single-record outputs and registers traceable files', async () => {
    const module = repository.createModule({ name: '\u516d\u79cd\u8f93\u51fa' })
    const record = repository.createRecord({
      moduleId: module.id,
      name: '\u539f\u59cb\u573a',
      link: 'https://log.weizaima.com/?key=six'
    })
    repository.updateRecord(record.id, {
      status: 'valid',
      cacheSourceUrl: record.link,
      rawContent: {
        parserVersion: 1,
        messages: [
          {
            id: 'm1',
            order: 0,
            displayName: 'KP',
            text: '\u6b63\u6587',
            type: 'text',
            isDiceCommand: false,
            isOffTopic: false,
            images: [{ url: 'https://example.com/a.png' }]
          }
        ]
      }
    })
    const service = new FileService(repository, async () => Buffer.from('%PDF-test'))
    const raw = await service.exportRecord(record.id, 'raw')
    const imageDoc = await service.exportRecord(record.id, 'doc')
    const dialogueDoc = await service.exportRecord(record.id, 'dialogue-doc')
    const docx = await service.exportRecord(record.id, 'docx')
    const txt = await service.exportRecord(record.id, 'txt')
    const pdf = await service.exportRecord(record.id, 'pdf')

    expect(path.extname(raw.path)).toBe('.json')
    expect(path.extname(imageDoc.path)).toBe('.doc')
    expect(path.extname(dialogueDoc.path)).toBe('.doc')
    expect(fs.readFileSync(raw.path, 'utf8')).toContain('parserVersion')
    expect(fs.readFileSync(imageDoc.path, 'utf8')).toContain('<img src="https://example.com/a.png"')
    expect(fs.readFileSync(dialogueDoc.path, 'utf8')).not.toContain('<img src=')
    expect(fs.readFileSync(docx.path).subarray(0, 2).toString()).toBe('PK')
    expect(fs.readFileSync(txt.path, 'utf8')).toContain('\u6b63\u6587')
    expect(fs.readFileSync(pdf.path).subarray(0, 4).toString()).toBe('%PDF')
    expect(repository.archiveEntriesFor('record', record.id)).toHaveLength(6)
  })
})
