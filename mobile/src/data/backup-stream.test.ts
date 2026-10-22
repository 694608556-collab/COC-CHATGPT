import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { strToU8, zipSync, Zip, ZipPassThrough, ZipDeflate } from 'fflate'
import { exampleBackup } from './fixtures'
import { previewBackup, encodeArchiveBackup } from './backup'
import { StreamSha256 } from './stream-sha256'
import { StreamJson } from './stream-json'
import { readBackupJsonStream, writeBackupJsonStream, recordMetadata } from './backup-stream'
import { readBackupZipStream, writeBackupZipStream } from './backup-zip-stream'
import type { SessionRecord } from '../../../src/shared/types'

const maximumBytes = 8 * 1024 * 1024
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function* chunks(bytes: Uint8Array, size = 4096) {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size)
}
async function* rows(records: SessionRecord[]) {
  yield* records
}
function join(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((n, value) => n + value.length, 0))
  let offset = 0
  for (const value of parts) {
    result.set(value, offset)
    offset += value.length
  }
  return result
}
async function fixture() {
  const complete = (await previewBackup(strToU8(JSON.stringify(exampleBackup())))).snapshot
  complete.records[0]!.rawContent!.messages[0]!.text += '\r\n\r\n公开😀\0引号"\\孤立\ud800末尾'
  complete.records[0]!.manualContent = '\r\n完整手动正文\0😀'
  return { complete, metadata: { ...complete, records: complete.records.map(recordMetadata) } }
}
const readOptions = (records: SessionRecord[] = []) => ({
  maximumBytes,
  stageRecord: async (record: SessionRecord) => {
    records.push(record)
  }
})

describe('分块摘要与严格JSON游标', () => {
  it('SHA-256标准向量、填充边界、任意分段和非零视图范围与系统实现逐字节相同', () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 8193, 1000000]) {
      const buffer = Uint8Array.from({ length: length + 11 }, (_, i) => (i * 37) & 255)
      const value = buffer.subarray(7, 7 + length)
      for (const size of [1, 55, 64, 4093]) {
        if (length > 10000 && size === 1) continue
        const digest = new StreamSha256()
        for (let i = 0; i < value.length; i += size) digest.update(value.subarray(i, i + size))
        expect(digest.bytes).toBe(value.length)
        expect(digest.digest()).toBe(sha(value))
        expect(() => digest.update(value)).toThrow('结束')
      }
    }
    const abc = new StreamSha256()
    abc.update(strToU8('abc'))
    expect(abc.digest()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('UTF-8逐字节跨段、BOM、换行、转义及任意JSON原值保持，原文件摘要包含BOM', async () => {
    const text = '\ufeff {"中文😀":["引号\\\"/\\u0000",true,null,-1.25e+3,{"x":"末尾"}]}\n'
    const bytes = strToU8(text),
      cursor = new StreamJson(chunks(bytes, 1), maximumBytes, maximumBytes)
    const value = await cursor.readValue()
    expect(value).toEqual(JSON.parse(text.slice(1)))
    expect(await cursor.finish()).toEqual({ bytes: bytes.length, sha256: sha(bytes) })
  })
  it.each([
    '{"a":1,"\\u0061":2}',
    '{"x":{"a":1,"a":2}}',
    '[1,]',
    '{"a":01}',
    '{"a":"\\x41"}',
    '{"a":true,}',
    'null false',
    '['
  ])('拒绝重复或损坏JSON：%s', async (text) => {
    const cursor = new StreamJson(chunks(strToU8(text), 1), maximumBytes, maximumBytes)
    await expect(
      (async () => {
        await cursor.readValue()
        await cursor.finish()
      })()
    ).rejects.toThrow()
  })
  it('独立字段和输入总量边界、非法UTF-8及取消均拒绝', async () => {
    const value = strToU8('"123456789"')
    await expect(new StreamJson(chunks(value), 100, 10).readValue()).rejects.toThrow('本次')
    await expect(new StreamJson(chunks(value), 10, 100).readValue()).rejects.toThrow('空间')
    await expect(
      new StreamJson(chunks(new Uint8Array([0x22, 0xc0, 0xaf, 0x22])), 100, 100).readValue()
    ).rejects.toThrow()
    const controller = new AbortController()
    controller.abort()
    await expect(new StreamJson(chunks(value), 100, 100, controller.signal).readValue()).rejects.toThrow(
      '取消'
    )
  })
})

describe('完整JSON分块备份与预览', () => {
  it('旧格式及手机envelope任意根字段顺序与旧预览一致，返回元数据不携带正文', async () => {
    const original = exampleBackup()
    const inputs = [original, { formatVersion: 1, snapshot: original, format: 'coc.logbook.android' }]
    for (const input of inputs) {
      const bytes = strToU8(JSON.stringify(input)),
        received: SessionRecord[] = []
      const result = await readBackupJsonStream(chunks(bytes, 7), {
        ...readOptions(received),
        expectedSource: { bytes: bytes.length, sha256: sha(bytes) }
      })
      const legacy = await previewBackup(bytes)
      expect(received).toEqual(legacy.snapshot.records)
      expect(result.metadata).toEqual({
        ...legacy.snapshot,
        records: legacy.snapshot.records.map(recordMetadata)
      })
      expect(result.offlineRecords).toBe(legacy.offlineRecords)
      expect(JSON.stringify(result.metadata)).not.toContain('rawContent')
      expect(result.source).toEqual({ bytes: bytes.length, sha256: sha(bytes) })
    }
  })
  it('完整输出可被原JSON恢复器读取，摘要、正文、空行和NUL都保留', async () => {
    const { complete, metadata } = await fixture()
    const parts: Uint8Array[] = []
    const proof = await writeBackupJsonStream(
      metadata,
      rows(complete.records),
      async (bytes) => {
        parts.push(bytes.slice())
      },
      { maximumBytes }
    )
    const bytes = join(parts)
    expect(proof).toEqual({ bytes: bytes.length, sha256: sha(bytes) })
    expect((await previewBackup(bytes)).snapshot).toEqual(complete)
    expect(parts.every((part) => part.length <= 256 * 1024)).toBe(true)
  })
  it('关联、重复ID、未知版本、来源身份及整体摘要失败不能形成有效预览', async () => {
    const base = exampleBackup()
    const invalid = [
      { ...base, schemaVersion: 99 },
      { ...base, records: [...base.records, base.records[0]] },
      { ...base, records: [{ ...base.records[0], moduleId: 'missing' }] },
      { ...base, records: [{ ...base.records[0], cacheSourceUrl: 'changed' }] }
    ]
    for (const input of invalid)
      await expect(
        readBackupJsonStream(chunks(strToU8(JSON.stringify(input))), readOptions())
      ).rejects.toThrow()
    const bytes = strToU8(JSON.stringify(base))
    await expect(
      readBackupJsonStream(chunks(bytes), {
        ...readOptions(),
        expectedSource: { bytes: bytes.length, sha256: '0'.repeat(64) }
      })
    ).rejects.toThrow('摘要')
  })
  it('暂存背压阻止继续读取，失败/取消关闭输入，不把元数据预览当完整快照', async () => {
    const base = exampleBackup()
    base.records.push({ ...base.records[0]!, id: 'second' })
    let read = 0,
      staged = 0,
      release!: () => void,
      started!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    async function* input() {
      for await (const bytes of chunks(strToU8(JSON.stringify(base)), 17)) {
        read += bytes.length
        yield bytes
      }
    }
    const promise = readBackupJsonStream(input(), {
      maximumBytes,
      stageRecord: async () => {
        staged++
        if (staged === 1) {
          started()
          await gate
        }
      }
    })
    await Promise.race([
      entered,
      promise.then(() => {
        throw new Error('Preview completed before staging gate')
      })
    ])
    const at = read
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(read).toBe(at)
    expect(staged).toBe(1)
    release()
    expect((await promise).metadata.records).toHaveLength(2)
    let closed = false
    async function* broken() {
      try {
        yield strToU8('{"records":[')
        throw new Error('source failure')
      } finally {
        closed = true
      }
    }
    await expect(readBackupJsonStream(broken(), readOptions())).rejects.toThrow('source failure')
    expect(closed).toBe(true)
  })
  it('输出缺场次、次序/元数据变化、超空间、取消或I/O失败均拒绝完成证明', async () => {
    const { complete, metadata } = await fixture()
    const sink = async () => {}
    await expect(writeBackupJsonStream(metadata, rows([]), sink, { maximumBytes })).rejects.toThrow('未取齐')
    await expect(
      writeBackupJsonStream(metadata, rows([{ ...complete.records[0]!, name: 'changed' }]), sink, {
        maximumBytes
      })
    ).rejects.toThrow('元数据')
    await expect(
      writeBackupJsonStream(metadata, rows(complete.records), sink, { maximumBytes: 10 })
    ).rejects.toThrow('空间')
    await expect(
      writeBackupJsonStream(
        metadata,
        rows(complete.records),
        async () => {
          throw new Error('disk full')
        },
        { maximumBytes }
      )
    ).rejects.toThrow('disk full')
    const controller = new AbortController()
    controller.abort()
    await expect(
      writeBackupJsonStream(metadata, rows(complete.records), sink, {
        maximumBytes,
        signal: controller.signal
      })
    ).rejects.toThrow('取消')
    await expect(
      writeBackupJsonStream(complete, rows(complete.records), sink, { maximumBytes })
    ).rejects.toThrow('元数据')
  })
})

describe('完整ZIP分块备份与预览', () => {
  it('读取旧压缩ZIP以及生成新ZIP均与旧恢复器正文/附件结果一致', async () => {
    const { complete, metadata } = await fixture(),
      attachment = strToU8('完整附件\r\n中文😀\0末尾')
    const old = await encodeArchiveBackup(complete, [{ name: '公开.txt', bytes: attachment }])
    const staged: SessionRecord[] = [],
      restored = new Map<string, Uint8Array[]>()
    const oldPreview = await readBackupZipStream(chunks(old, 11), {
      ...readOptions(staged),
      maximumExpandedBytes: maximumBytes,
      stageAttachment: async (path, data) => {
        restored.set(path, [...(restored.get(path) ?? []), data.slice()])
      }
    })
    expect(staged).toEqual(complete.records)
    expect(oldPreview.attachments).toHaveLength(1)
    expect(join(restored.get(oldPreview.attachments[0]!.zipPath)!)).toEqual(attachment)
    const output: Uint8Array[] = []
    const proof = await writeBackupZipStream(
      metadata,
      rows(complete.records),
      [
        { name: '公开.txt', bytes: attachment.length, sha256: sha(attachment), chunks: chunks(attachment, 3) }
      ],
      async (data) => {
        output.push(data.slice())
      },
      { maximumBytes }
    )
    const bytes = join(output),
      legacy = await previewBackup(bytes)
    expect(legacy.snapshot).toEqual(complete)
    expect(legacy.attachments?.[0]?.bytes).toEqual(attachment)
    expect(proof).toEqual({ bytes: bytes.length, sha256: sha(bytes) })
    expect(
      (await readBackupZipStream(chunks(bytes, 7), { ...readOptions(), maximumExpandedBytes: maximumBytes }))
        .attachments
    ).toHaveLength(1)
  })
  it('拒绝目录穿越、缺少备份、截断中央目录、CRC损坏及声明/实际解压超预算', async () => {
    const backup = strToU8(JSON.stringify(exampleBackup()))
    const paths = zipSync({ 'backup.json': backup, '../escape': strToU8('x') })
    const missing = zipSync({ 'unknown.txt': strToU8('x') })
    const good = zipSync({ 'backup.json': backup }, { level: 0 })
    const crc = good.slice()
    const signature = strToU8('离线正文')
    let changed = false
    for (let i = 0; i < crc.length - signature.length; i++)
      if (signature.every((byte, n) => crc[i + n] === byte)) {
        crc[i] = 0xe6
        crc[i + 1] = 0xb5
        crc[i + 2] = 0x8b
        changed = true
        break
      }
    expect(changed).toBe(true)
    for (const input of [paths, missing, good.subarray(0, good.length - 22), crc])
      await expect(
        readBackupZipStream(chunks(input, 31), { ...readOptions(), maximumExpandedBytes: maximumBytes })
      ).rejects.toThrow()
    await expect(
      readBackupZipStream(chunks(good), { ...readOptions(), maximumExpandedBytes: 10 })
    ).rejects.toThrow()
  })
  it('流式未知长度ZIP、重复条目、整体证明和附件摘要失败全部拒绝', async () => {
    const backup = strToU8(JSON.stringify(exampleBackup()))
    function archive(duplicate: boolean) {
      const parts: Uint8Array[] = [],
        zip = new Zip((error, data) => {
          if (error) throw error
          parts.push(data)
        })
      const file = new ZipDeflate('backup.json')
      zip.add(file)
      file.push(backup, true)
      if (duplicate) {
        const second = new ZipPassThrough('backup.json')
        zip.add(second)
        second.push(backup, true)
      }
      zip.end()
      return join(parts)
    }
    const streamed = archive(false)
    expect(
      (
        await readBackupZipStream(chunks(streamed, 13), {
          ...readOptions(),
          maximumExpandedBytes: maximumBytes
        })
      ).metadata.records
    ).toHaveLength(1)
    await expect(
      readBackupZipStream(chunks(archive(true), 23), { ...readOptions(), maximumExpandedBytes: maximumBytes })
    ).rejects.toThrow('重复')
    await expect(
      readBackupZipStream(chunks(streamed), {
        ...readOptions(),
        maximumExpandedBytes: maximumBytes,
        expectedSource: { bytes: streamed.length, sha256: '0'.repeat(64) }
      })
    ).rejects.toThrow('摘要')
    const { complete, metadata } = await fixture()
    await expect(
      writeBackupZipStream(
        metadata,
        rows(complete.records),
        [{ name: 'a', bytes: 1, sha256: '0'.repeat(64), chunks: chunks(strToU8('x')) }],
        async () => {},
        { maximumBytes }
      )
    ).rejects.toThrow('摘要')
    await expect(
      readBackupZipStream(chunks(streamed), { ...readOptions(), maximumExpandedBytes: 100 })
    ).rejects.toThrow()
  })
  it('拒绝伪造本地偏移、压缩长度、流式描述符与无法发布的暂存写入', async () => {
    const backup = strToU8(JSON.stringify(exampleBackup()))
    const parts: Uint8Array[] = [],
      writer = new Zip((error, bytes) => {
        if (error) throw error
        parts.push(bytes)
      })
    const file = new ZipPassThrough('backup.json')
    writer.add(file)
    file.push(backup, true)
    writer.end()
    const input = join(parts),
      original = new DataView(input.buffer)
    let central = -1,
      descriptor = -1
    for (let i = 0; i < input.length - 4; i++) {
      if (original.getUint32(i, true) === 0x02014b50) central = i
      if (original.getUint32(i, true) === 0x08074b50) descriptor = i
    }
    expect(central).toBeGreaterThan(0)
    expect(descriptor).toBeGreaterThan(0)
    for (const offset of [central + 42, central + 20, descriptor + 4, descriptor + 8, descriptor + 12]) {
      const changed = input.slice()
      changed[offset] = changed[offset]! ^ 1
      await expect(
        readBackupZipStream(chunks(changed, 13), { ...readOptions(), maximumExpandedBytes: maximumBytes })
      ).rejects.toThrow('ZIP')
    }
    let closed = false
    async function* source() {
      try {
        yield* chunks(input, 23)
      } finally {
        closed = true
      }
    }
    await expect(
      readBackupZipStream(source(), {
        maximumBytes,
        maximumExpandedBytes: maximumBytes,
        stageRecord: async () => {
          throw new Error('private disk full')
        }
      })
    ).rejects.toThrow('private disk full')
    expect(closed).toBe(true)
  })
})
