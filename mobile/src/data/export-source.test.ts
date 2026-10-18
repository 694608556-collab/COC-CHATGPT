import { afterEach, expect, it, vi } from 'vitest'
import { performExportSourceJob } from './export-source'
import { searchSample } from '../dev/sample'
import { previewBackup } from './backup'

afterEach(() => vi.unstubAllGlobals())

it('文件生成等待期间关闭租约，不能返回可供发布的旧文件', async () => {
  const sample = searchSample(),
    bytes = new TextEncoder().encode(JSON.stringify(sample))
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal('fetch', async () => new Response(bytes))
  const id = 'generating-close'
  await performExportSourceJob({
    type: 'export-source-open',
    source: { id, url: 'https://localhost/_capacitor_file_/public.json', bytes: bytes.length, sha256 },
    ids: sample.records.map((r) => r.id)
  })
  const pending = performExportSourceJob({
    type: 'export-source-file',
    id,
    moduleId: sample.modules[0]!.id,
    ids: [sample.records[0]!.id],
    filters: sample.settings.filterPreset,
    format: 'txt',
    combined: false
  })
  await performExportSourceJob({ type: 'export-source-close', id })
  await expect(pending).rejects.toThrow('失效')
})

it('读取未完成时关闭租约，迟到的打开结果不能复活正文且允许重试', async () => {
  const sample = searchSample(),
    bytes = new TextEncoder().encode(JSON.stringify(sample))
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal('fetch', async () => {
    await waiting
    return new Response(bytes)
  })
  const source = {
    id: 'pending-close',
    url: 'https://localhost/_capacitor_file_/public.json',
    bytes: bytes.length,
    sha256
  }
  const ids = sample.records.map((r) => r.id)
  const opening = performExportSourceJob({ type: 'export-source-open', source, ids })
  await performExportSourceJob({ type: 'export-source-close', id: source.id })
  const rejected = expect(opening).rejects.toThrow('失效')
  release()
  await rejected
  await expect(
    performExportSourceJob({ type: 'export-source-backup', id: source.id, name: 'public.json' })
  ).rejects.toThrow('失效')
  await performExportSourceJob({ type: 'export-source-open', source: { ...source, id: 'retry-close' }, ids })
  const file = await performExportSourceJob({
    type: 'export-source-backup',
    id: 'retry-close',
    name: 'public.json'
  })
  if (!('bytes' in file)) throw new Error('File result required')
  expect((await previewBackup(file.bytes)).snapshot.records).toEqual(sample.records)
  await performExportSourceJob({ type: 'export-source-close', id: 'retry-close' })
})

it('附件读取期间关闭租约后拒绝旧备份，不能混入后打开的数据源', async () => {
  const sample = searchSample(),
    bytes = new TextEncoder().encode(JSON.stringify(sample)),
    attachment = new TextEncoder().encode('公开附件')
  const digest = async (input: Uint8Array<ArrayBuffer>) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
  let release!: () => void, entered!: () => void
  const enteredRead = new Promise<void>((resolve) => {
    entered = resolve
  })
  const pendingRead = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/_capacitor_file_/')) return new Response(bytes)
    entered()
    await pendingRead
    return new Response(attachment)
  })
  const source = {
      id: 'old-source',
      url: 'https://localhost/_capacitor_file_/public.json',
      bytes: bytes.length,
      sha256: await digest(bytes)
    },
    ids = sample.records.map((r) => r.id)
  await performExportSourceJob({ type: 'export-source-open', source, ids })
  const pending = performExportSourceJob({
    type: 'export-source-backup',
    id: source.id,
    name: 'public.zip',
    files: [
      {
        name: 'public.txt',
        url: 'https://localhost/_capacitor_content_/public.txt',
        bytes: attachment.length,
        sha256: await digest(attachment)
      }
    ]
  })
  await enteredRead
  await performExportSourceJob({ type: 'export-source-close', id: source.id })
  await performExportSourceJob({ type: 'export-source-open', source: { ...source, id: 'new-source' }, ids })
  const rejection = expect(pending).rejects.toThrow('失效')
  release()
  await rejection
  await performExportSourceJob({ type: 'export-source-close', id: 'new-source' })
})

it('完整后台正文可打包为含校验附件的 ZIP，重新打开保留正文和关联', async () => {
  const sample = searchSample(),
    snapshotBytes = new TextEncoder().encode(JSON.stringify(sample))
  const attachment = new TextEncoder().encode('公开归档正文\n完整末尾😀')
  const hash = async (bytes: Uint8Array<ArrayBuffer>) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(url.includes('/_capacitor_file_/') ? snapshotBytes : attachment)
  )
  await performExportSourceJob({
    type: 'export-source-open',
    source: {
      id: 'public-zip',
      url: 'https://localhost/_capacitor_file_/snapshot.json',
      bytes: snapshotBytes.length,
      sha256: await hash(snapshotBytes)
    },
    ids: sample.records.map((r) => r.id)
  })
  const file = await performExportSourceJob({
    type: 'export-source-backup',
    id: 'public-zip',
    name: 'public-complete.zip',
    files: [
      {
        name: '公开正文.txt',
        url: 'https://localhost/_capacitor_content_/public.txt',
        bytes: attachment.length,
        sha256: await hash(attachment)
      }
    ]
  })
  if (!('bytes' in file)) throw new Error('File result required')
  const read = await previewBackup(file.bytes)
  expect(read.snapshot.records).toEqual(sample.records)
  expect(read.snapshot.modules).toEqual(sample.modules)
  expect(read.attachments?.[0]?.bytes).toEqual(attachment)
  await performExportSourceJob({ type: 'export-source-close', id: 'public-zip' })
})

it('正文源字节改变或目标重复时整批拒绝，不能沿用上一份正文', async () => {
  const sample = searchSample(),
    bytes = new TextEncoder().encode(JSON.stringify(sample))
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal('fetch', async () => new Response(bytes))
  const source = {
    id: 'public-protected',
    url: 'https://localhost/_capacitor_file_/public.json',
    bytes: bytes.length,
    sha256
  }
  await performExportSourceJob({ type: 'export-source-open', source, ids: sample.records.map((r) => r.id) })
  await expect(
    performExportSourceJob({
      type: 'export-source-open',
      source: { ...source, sha256: '0'.repeat(64) },
      ids: sample.records.map((r) => r.id)
    })
  ).rejects.toThrow('校验')
  await expect(
    performExportSourceJob({
      type: 'export-source-file',
      id: source.id,
      moduleId: sample.modules[0]!.id,
      ids: [sample.records[0]!.id],
      filters: sample.settings.filterPreset,
      format: 'txt',
      combined: false
    })
  ).rejects.toThrow('失效')
  await expect(
    performExportSourceJob({
      type: 'export-source-open',
      source,
      ids: [sample.records[0]!.id, sample.records[0]!.id]
    })
  ).rejects.toThrow('重复')
})

it('后台只读文件源校验完整字节后导出原始正文，关闭后不可继续读取', async () => {
  const sample = searchSample(),
    bytes = new TextEncoder().encode(JSON.stringify(sample))
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  vi.stubGlobal('location', new URL('https://localhost/'))
  vi.stubGlobal('fetch', async () => new Response(bytes))
  await performExportSourceJob({
    type: 'export-source-open',
    source: {
      id: 'public-source',
      url: 'https://localhost/_capacitor_file_/public.json',
      bytes: bytes.length,
      sha256
    },
    ids: sample.records.map((r) => r.id)
  })
  const file = await performExportSourceJob({
    type: 'export-source-file',
    id: 'public-source',
    moduleId: sample.modules[0]!.id,
    ids: [sample.records[0]!.id],
    filters: sample.settings.filterPreset,
    format: 'raw',
    combined: false
  })
  if (!('bytes' in file)) throw new Error('File result required')
  expect(JSON.parse(new TextDecoder().decode(file.bytes))).toEqual(sample.records[0]!.rawContent)
  await performExportSourceJob({ type: 'export-source-close', id: 'public-source' })
  await expect(
    performExportSourceJob({
      type: 'export-source-file',
      id: 'public-source',
      moduleId: sample.modules[0]!.id,
      ids: [sample.records[0]!.id],
      filters: sample.settings.filterPreset,
      format: 'raw',
      combined: false
    })
  ).rejects.toThrow('失效')
})
