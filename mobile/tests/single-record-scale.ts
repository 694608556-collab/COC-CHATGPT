import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, statfsSync } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createInterface } from 'node:readline'
import { exampleBackup } from '../src/data/fixtures'
import { previewBackup } from '../src/data/backup'
import { performTableStreamJob } from '../src/data/table-stream-job'
import { performSnapshotJob } from '../src/data/snapshot-job'
import { writeBackupJsonStream, recordMetadata } from '../src/data/backup-stream'
import { writeBackupZipStream } from '../src/data/backup-zip-stream'
import { prepareRestoreStream } from '../src/data/restore-stream'
import { decodeBase64 } from '../src/data/bytes'
import type { SessionRecord } from '../../src/shared/types'

async function main() {
  const work = process.argv[2]!,
    onlyJson = process.argv.includes('--json-only')
  const MiB = 1024 * 1024,
    bodyBytes = 70 * MiB
  const free = statfsSync(work),
    maximumBytes = Math.floor((free.bavail * free.bsize) / 6)
  assert(
    maximumBytes > bodyBytes * 4,
    'Actual available disk space must cover public staging/rollback copies'
  )
  let peakHeap = 0,
    peakRss = 0,
    peakExternal = 0
  const memory = () => {
    const m = process.memoryUsage()
    peakHeap = Math.max(peakHeap, m.heapUsed)
    peakRss = Math.max(peakRss, m.rss)
    peakExternal = Math.max(peakExternal, m.external)
  }
  const started = performance.now()
  const csvPath = join(work, 'public-single.csv'),
    csv = await open(csvPath, 'wx')
  const sourceDigest = createHash('sha256'),
    bodyDigest = createHash('sha256')
  let sourceBytes = 0
  const prefix = 'PUBLIC SINGLE RECORD 开始😀\nquoted "value"\0',
    suffix = '\n完整结尾 😀 END'
  const fillBytes = bodyBytes - Buffer.byteLength(prefix + suffix)
  async function writeAll(handle: Awaited<ReturnType<typeof open>>, bytes: Uint8Array) {
    let offset = 0
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset)
      assert(bytesWritten > 0)
      offset += bytesWritten
    }
  }
  async function csvWrite(bytes: Uint8Array) {
    await writeAll(csv, bytes)
    sourceDigest.update(bytes)
    sourceBytes += bytes.length
  }
  await csvWrite(Buffer.from('\ufeff模组名,场次名,手动保存内容\r\n公开团,公开单场,"'))
  await csvWrite(Buffer.from(prefix.replaceAll('"', '""')))
  bodyDigest.update(prefix)
  const fill = Buffer.alloc(64 * 1024, 0x78)
  for (let remaining = fillBytes; remaining > 0;) {
    const chunk = fill.subarray(0, Math.min(remaining, fill.length))
    await csvWrite(chunk)
    bodyDigest.update(chunk)
    remaining -= chunk.length
  }
  await csvWrite(Buffer.from(suffix + '"\r\n'))
  bodyDigest.update(suffix)
  await csv.sync()
  await csv.close()
  const sourceProof = { bytes: sourceBytes, sha256: sourceDigest.digest('hex') },
    bodySha256 = bodyDigest.digest('hex')
  Object.assign(globalThis, {
    location: new URL('https://localhost/'),
    fetch: async (url: string | URL) => {
      assert.equal(String(url), 'https://localhost/_capacitor_file_/public-single.csv')
      return new Response(
        Readable.toWeb(createReadStream(csvPath, { highWaterMark: 64 * 1024 })) as ReadableStream<Uint8Array>,
        { headers: { 'content-length': String(sourceBytes) } }
      )
    }
  })
  const candidatePath = join(work, 'table-candidate'),
    candidate = await open(candidatePath, 'wx')
  const candidateDigest = createHash('sha256')
  let candidateBytes = 0,
    inFlight = false,
    maxChunk = 0,
    acknowledgements = 0
  const result = await performTableStreamJob(
    {
      source: { ...sourceProof, url: 'https://localhost/_capacitor_file_/public-single.csv' },
      name: 'public-single.csv',
      format: 'csv',
      kind: 'records',
      maximumStageBytes: maximumBytes
    },
    async (key, bytes) => {
      assert.equal(key, 'candidate')
      assert(!inFlight)
      inFlight = true
      assert(bytes.length <= 256 * 1024)
      maxChunk = Math.max(maxChunk, bytes.length)
      await writeAll(candidate, bytes)
      candidateDigest.update(bytes)
      candidateBytes += bytes.length
      if (++acknowledgements % 32 === 0) await new Promise((resolve) => setTimeout(resolve, 1))
      memory()
      inFlight = false
    },
    async () => {
      throw new Error('CSV cannot request SST')
    }
  )
  await candidate.sync()
  await candidate.close()
  assert.equal(result.candidates, 1)
  assert.deepEqual(result.candidate, { bytes: candidateBytes, sha256: candidateDigest.digest('hex') })
  assert(candidateBytes > 64 * MiB)
  let rawCandidate = await readFile(candidatePath, 'utf8')
  assert(rawCandidate.startsWith('T') && rawCandidate.endsWith('\n'))
  const parsed = JSON.parse(rawCandidate.slice(1)) as { value: { manualContent: string } }
  rawCandidate = ''
  const base = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const record: SessionRecord = {
    ...base.records[0]!,
    sourceType: 'manual',
    status: 'manual',
    manualContent: parsed.value.manualContent
  }
  assert.equal(Buffer.byteLength(record.manualContent!), bodyBytes)
  assert.equal(createHash('sha256').update(record.manualContent!).digest('hex'), bodySha256)
  const originalRawSha256 = createHash('sha256').update(JSON.stringify(record.rawContent)).digest('hex')
  const metadata = { ...base, records: [recordMetadata(record)] }
  const phases: unknown[] = [
    {
      phase: 'csv-private-table-candidate',
      bytes: candidateBytes,
      bodyBytes,
      bodySha256,
      acknowledgements,
      maxChunk
    }
  ]
  for (const format of (onlyJson ? ['json'] : ['json', 'zip']) as Array<'json' | 'zip'>) {
    const phaseStart = performance.now(),
      outputPath = join(work, 'complete.' + format),
      output = await open(outputPath, 'wx'),
      outputDigest = createHash('sha256')
    let outputBytes = 0
    async function* records() {
      yield record
    }
    const sink = async (bytes: Uint8Array) => {
      assert(bytes.length <= 256 * 1024)
      await writeAll(output, bytes)
      outputDigest.update(bytes)
      outputBytes += bytes.length
      memory()
    }
    const proof =
      format === 'json'
        ? await writeBackupJsonStream(metadata, records(), sink, { maximumBytes })
        : await writeBackupZipStream(metadata, records(), [], sink, { maximumBytes })
    await output.sync()
    await output.close()
    assert.deepEqual(proof, { bytes: outputBytes, sha256: outputDigest.digest('hex') })
    const restorePath = join(work, 'restore-' + format),
      restore = await open(restorePath, 'wx'),
      restoredDigest = createHash('sha256')
    let restoredBytes = 0
    const restored = await prepareRestoreStream(
      () => createReadStream(outputPath, { highWaterMark: 64 * 1024 }),
      {
        format,
        expectedSource: proof,
        maximumStageBytes: maximumBytes,
        async write(key, bytes) {
          assert.equal(key, 'candidate')
          assert(bytes.length <= 256 * 1024)
          await writeAll(restore, bytes)
          restoredDigest.update(bytes)
          restoredBytes += bytes.length
          memory()
        }
      }
    )
    await restore.sync()
    await restore.close()
    assert.deepEqual(restored.candidate, { bytes: restoredBytes, sha256: restoredDigest.digest('hex') })
    let recordsSeen = 0,
      metadataSeen = 0
    for await (const line of createInterface({
      input: createReadStream(restorePath, { highWaterMark: 64 * 1024 }),
      crlfDelay: Infinity
    })) {
      if (line[0] === 'R') {
        const checked = JSON.parse(line.slice(1)) as SessionRecord
        assert.equal(Buffer.byteLength(checked.manualContent!), bodyBytes)
        assert.equal(createHash('sha256').update(checked.manualContent!).digest('hex'), bodySha256)
        assert.equal(
          createHash('sha256').update(JSON.stringify(checked.rawContent)).digest('hex'),
          originalRawSha256
        )
        recordsSeen++
      } else {
        assert.equal(line[0], 'M')
        const checked = JSON.parse(line.slice(1))
        assert.equal(checked.records.length, 1)
        assert.equal(checked.records[0].rawContent, undefined)
        metadataSeen++
      }
      memory()
    }
    assert.equal(recordsSeen, 1)
    assert.equal(metadataSeen, 1)
    assert.equal(restored.preview.offlineRecords, 1)
    phases.push({
      phase: format + '-backup-and-private-restore',
      fileBytes: proof.bytes,
      fileSha256: proof.sha256,
      candidateBytes: restoredBytes,
      candidateSha256: restored.candidate.sha256,
      recordsSeen,
      metadataSeen,
      milliseconds: Math.round(performance.now() - phaseStart)
    })
    global.gc?.()
    memory()
  }
  // The exact editing path must also accept a full request beyond the former quota.
  const upload = (await performSnapshotJob({
    type: 'prepare-upload',
    snapshot: { ...base, records: [record] }
  })) as { id: string; bytes: number; count: number; sha256: string }
  assert(upload.bytes > 64 * MiB)
  const uploadHash = createHash('sha256')
  let uploadBytes = 0
  for (let index = 0; index < upload.count; index++) {
    const bytes = decodeBase64(
      (await performSnapshotJob({ type: 'upload-chunk', id: upload.id, index })) as string
    )
    assert(bytes.length <= 256 * 1024)
    uploadHash.update(bytes)
    uploadBytes += bytes.length
    memory()
  }
  assert.equal(uploadBytes, upload.bytes)
  assert.equal(uploadHash.digest('hex'), upload.sha256)
  await performSnapshotJob({ type: 'upload-close', id: upload.id })
  phases.push({
    phase: 'complete-edit-upload',
    bytes: upload.bytes,
    chunks: upload.count,
    sha256: upload.sha256
  })
  console.log(
    JSON.stringify({
      kind: 'public-single-record-resource-check',
      host: `${process.platform}/${process.arch}`,
      node: process.version,
      recordCount: 1,
      manualBodyBytes: bodyBytes,
      manualBodySha256: bodySha256,
      retainedRawSha256: originalRawSha256,
      sourceProof,
      heapFlagMiB: 1024,
      peakHeapBytes: peakHeap,
      peakRssBytes: Math.max(peakRss, process.resourceUsage().maxRSS * 1024),
      peakExternalBytes: peakExternal,
      milliseconds: Math.round(performance.now() - started),
      phases,
      scope:
        'Desktop shared parser, table candidate, complete backup/restore candidate and edit upload; real private temporary files. Not phone/native CAS acceptance. Runtime memory is measured, not a new production quota.'
    })
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
