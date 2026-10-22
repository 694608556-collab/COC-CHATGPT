import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { unzipSync, strToU8, strFromU8 } from 'fflate'
import { exampleBackup } from './fixtures'
import { encodeBackup, previewBackup } from './backup'
import { prepareRestoreStream } from './restore-stream'
import { writeCanonicalBackupZipStream } from './backup-zip-stream'
import { previewNativeBackup, exportNativeBackup } from './backup-stream-client'
import type { BackupStreamPort, NativeRestoreSource } from './backup-stream-native'

afterEach(() => vi.unstubAllGlobals())
const maximum = 8 * 1024 * 1024
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function* chunks(bytes: Uint8Array, size = 13) {
  for (let start = 0; start < bytes.length; start += size) yield bytes.subarray(start, start + size)
}
const join = (parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts))
async function canonical() {
  const data = (await previewBackup(strToU8(JSON.stringify(exampleBackup())))).snapshot
  data.records[0]!.rawContent!.messages[0]!.raw = { integer: 'RAW_INTEGER', escaped: '引号"\\\0😀' }
  return strToU8(strFromU8(encodeBackup(data)).replace('"RAW_INTEGER"', '900719925474099312345'))
}
it('候选保留大数字原始正文词元，同时剔除未知业务字段及补齐旧默认值', async () => {
  const original = exampleBackup() as unknown as Record<string, any>
  const record = original.records[0]
  delete record.sequenceNo
  record.unknownRecord = 'drop-record'
  record.manualContent = '\n\n\0😀末尾'
  record.rawContent.unknownLog = 'drop-log'
  record.rawContent.messages[0].unknownMessage = 'drop-message'
  record.rawContent.messages[0].raw = { integer: 'RAW_INTEGER', nested: [{ unknownUserValue: true }] }
  const source = strToU8(JSON.stringify(original).replace('"RAW_INTEGER"', '900719925474099312345'))
  const staged: Uint8Array[] = []
  const result = await prepareRestoreStream(chunks(source), {
    format: 'json',
    expectedSource: { bytes: source.length, sha256: sha(source) },
    maximumStageBytes: maximum,
    write: async (key, chunk) => {
      expect(key).toBe('candidate')
      staged.push(chunk.slice())
    }
  })
  const candidate = join(staged),
    text = strFromU8(candidate),
    lines = text.trimEnd().split('\n')
  expect(lines).toHaveLength(2)
  expect(text).toContain('900719925474099312345')
  expect(text).not.toContain('drop-record')
  expect(text).not.toContain('drop-log')
  expect(text).not.toContain('drop-message')
  const complete = JSON.parse(lines[0]!.slice(1)),
    metadata = JSON.parse(lines[1]!.slice(1))
  expect(complete.sequenceNo).toBe(0)
  expect(complete.manualContent).toBe(record.manualContent)
  expect(complete.rawContent.messages[0].raw.nested).toEqual([{ unknownUserValue: true }])
  expect(metadata.records[0]).not.toHaveProperty('rawContent')
  expect(metadata.records[0]).not.toHaveProperty('manualContent')
  expect(result.candidate).toEqual({ bytes: candidate.length, sha256: sha(candidate) })
})
it('规范原生JSON逐字节保留正文打包，旧ZIP恢复器和新候选均可读取', async () => {
  const source = await canonical(),
    file = strToU8('完整附件\n\0😀'),
    parts: Uint8Array[] = []
  await writeCanonicalBackupZipStream(
    chunks(source),
    { bytes: source.length, sha256: sha(source) },
    [
      { name: '公开.txt', bytes: file.length, sha256: sha(file), chunks: chunks(file) },
      { name: '空.txt', bytes: 0, sha256: sha(new Uint8Array()), chunks: chunks(new Uint8Array()) }
    ],
    async (bytes) => {
      parts.push(bytes.slice())
    },
    { maximumBytes: maximum }
  )
  const zip = join(parts),
    entry = strFromU8(unzipSync(zip)['backup.json']!)
  expect(entry.startsWith(strFromU8(source).slice(0, -2))).toBe(true)
  expect(entry).toContain('900719925474099312345')
  const old = await previewBackup(zip)
  expect(old.attachments?.map((item) => item.bytes)).toEqual([file, new Uint8Array()])
  const staged = new Map<string, Uint8Array[]>()
  const restored = await prepareRestoreStream(chunks(zip, 37), {
    format: 'zip',
    expectedSource: { bytes: zip.length, sha256: sha(zip) },
    maximumStageBytes: maximum,
    write: async (key, bytes) => {
      const list = staged.get(key) ?? []
      list.push(bytes.slice())
      staged.set(key, list)
    }
  })
  expect(restored.attachments).toHaveLength(2)
  expect(strFromU8(join(staged.get('candidate')!))).toContain('900719925474099312345')
  expect(join(staged.get('zip:archives/0-公开.txt')!)).toEqual(file)
})
it('摘要、结束标记、空间及私有写入失败不能返回有效候选或ZIP证明', async () => {
  const source = await canonical(),
    proof = { bytes: source.length, sha256: sha(source) }
  const write = async () => {}
  await expect(
    prepareRestoreStream(chunks(source), {
      format: 'json',
      expectedSource: { ...proof, sha256: '0'.repeat(64) },
      maximumStageBytes: maximum,
      write
    })
  ).rejects.toThrow('摘要')
  await expect(
    prepareRestoreStream(chunks(source), {
      format: 'json',
      expectedSource: proof,
      maximumStageBytes: 10,
      write
    })
  ).rejects.toThrow('空间')
  let closed = false
  async function* input() {
    try {
      yield* chunks(source)
    } finally {
      closed = true
    }
  }
  await expect(
    prepareRestoreStream(input(), {
      format: 'json',
      expectedSource: proof,
      maximumStageBytes: maximum,
      write: async () => {
        throw new Error('private disk full')
      }
    })
  ).rejects.toThrow('private disk full')
  expect(closed).toBe(true)
  await expect(
    writeCanonicalBackupZipStream(chunks(source), { ...proof, sha256: '0'.repeat(64) }, [], write, {
      maximumBytes: maximum
    })
  ).rejects.toThrow('摘要')
  const badEnd = source.slice()
  badEnd[badEnd.length - 1] = 93
  await expect(
    writeCanonicalBackupZipStream(chunks(badEnd), { bytes: badEnd.length, sha256: sha(badEnd) }, [], write, {
      maximumBytes: maximum
    })
  ).rejects.toThrow('结束标记')
})

function device(source: Uint8Array, fail = false) {
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array(source).buffer))
  const staged = new Map<string, Uint8Array[]>(),
    indexes = new Map<string, number>()
  const sourceRef: NativeRestoreSource = {
    id: 'native-owned',
    fileUri: 'https://localhost/_capacitor_file_/public',
    bytes: source.length,
    sha256: sha(source),
    format: 'json',
    revision: 7,
    maximumStageBytes: maximum
  }
  const port: Required<BackupStreamPort> = {
    appendBackupStage: vi.fn(async ({ id, key, index, base64 }) => {
      expect(id).toBe(sourceRef.id)
      expect(index).toBe(indexes.get(key) ?? 0)
      const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
      expect(bytes.length).toBeLessThanOrEqual(256 * 1024)
      if (fail) throw new Error('native write failed')
      const list = staged.get(key) ?? []
      list.push(bytes)
      staged.set(key, list)
      indexes.set(key, index + 1)
    }),
    finishBackupPreview: vi.fn(async ({ id, candidate }) => {
      const bytes = join(staged.get('candidate')!)
      expect(candidate).toEqual({ bytes: bytes.length, sha256: sha(bytes) })
      return { id, revision: 7, offlineRecords: 1 }
    }),
    commitBackupRestore: vi.fn(async () => ({ revision: 8 })),
    cancelBackupStage: vi.fn(async () => {}),
    createBackupStream: vi.fn(async () => ({
      id: sourceRef.id,
      revision: 7,
      source: { ...sourceRef, canonicalVersion: 1 as const },
      files: [],
      maximumBytes: maximum
    })),
    finishBackupExport: vi.fn(async ({ id, name, proof }) => {
      expect(id).toBe(sourceRef.id)
      if (proof) {
        const bytes = join(staged.get('output')!)
        expect(proof).toEqual({ bytes: bytes.length, sha256: sha(bytes) })
        expect((await previewBackup(bytes)).offlineRecords).toBe(1)
      }
      return {
        uri: 'native-created',
        name,
        bytes: proof?.bytes ?? source.length,
        sha256: proof?.sha256 ?? sha(source)
      }
    })
  }
  return { port, sourceRef }
}
it('原生预览成功只返回去正文租约，不自动确认；取消/失败只清理本次ID', async () => {
  const source = await canonical(),
    { port, sourceRef } = device(source)
  const preview = await previewNativeBackup(port, sourceRef)
  expect(preview.lease).toBe(sourceRef.id)
  expect(preview.snapshot.records[0]).not.toHaveProperty('rawContent')
  expect(port.commitBackupRestore).not.toHaveBeenCalled()
  expect(port.cancelBackupStage).not.toHaveBeenCalled()
  const denied = device(source, true)
  await expect(previewNativeBackup(denied.port, denied.sourceRef)).rejects.toThrow('native write failed')
  expect(denied.port.cancelBackupStage).toHaveBeenCalledWith({ id: sourceRef.id })
  expect(denied.port.finishBackupPreview).not.toHaveBeenCalled()
  expect(denied.port.commitBackupRestore).not.toHaveBeenCalled()
})
it('原生计数/版本证明不一致拒绝预览，并在JSON/ZIP成功后释放私有任务', async () => {
  const source = await canonical(),
    wrong = device(source)
  wrong.port.finishBackupPreview = vi.fn(async () => ({
    id: wrong.sourceRef.id,
    revision: 8,
    offlineRecords: 1
  }))
  await expect(previewNativeBackup(wrong.port, wrong.sourceRef)).rejects.toThrow('证明不一致')
  expect(wrong.port.cancelBackupStage).toHaveBeenCalledWith({ id: wrong.sourceRef.id })
  for (const archives of [false, true]) {
    const { port } = device(source)
    expect((await exportNativeBackup(port, 7, archives, archives ? 'public.zip' : 'public.json')).uri).toBe(
      'native-created'
    )
    expect(port.finishBackupExport).toHaveBeenCalledTimes(1)
    expect(port.cancelBackupStage).toHaveBeenCalledWith({ id: 'native-owned' })
    expect(port.commitBackupRestore).not.toHaveBeenCalled()
    if (!archives) expect(port.appendBackupStage).not.toHaveBeenCalled()
  }
})
