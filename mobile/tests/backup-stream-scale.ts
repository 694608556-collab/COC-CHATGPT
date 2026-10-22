import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { exampleBackup } from '../src/data/fixtures'
import { previewBackup } from '../src/data/backup'
import { readBackupJsonStream, writeBackupJsonStream, recordMetadata } from '../src/data/backup-stream'
import { readBackupZipStream, writeBackupZipStream } from '../src/data/backup-zip-stream'
import type { SessionRecord } from '../../src/shared/types'
import { Zip, ZipDeflate } from 'fflate'

const MiB = 1024 * 1024
async function main() {
  const work = process.argv[2]!
  const scales = process.argv.slice(3).map(Number)
  if (!scales.length) scales.push(96, 192, 512)
  assert(
    scales.every((value) => Number.isInteger(value) && value >= 65 && value <= 2048),
    'Synthetic check accepts 65..2048 records of 1MiB; this is not a product limit'
  )
  const base = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const seed = base.records[0]!
  // Each record has a full 1MiB body with Unicode, newlines, NUL and per-record
  // identity. Never build an array of body-bearing records or join file chunks.
  const text = '公开😀\n\0'.repeat(16) + 'x'.repeat(MiB)
  const body = seed.rawContent!
  for (const count of scales)
    for (const format of ['json', 'zip', 'deflate'] as const) {
      let peakHeap = 0,
        peakExternal = 0,
        peakRss = 0
      function memory() {
        const m = process.memoryUsage()
        peakHeap = Math.max(peakHeap, m.heapUsed)
        peakExternal = Math.max(peakExternal, m.external)
        peakRss = Math.max(peakRss, m.rss)
      }
      function row(index: number): SessionRecord {
        return {
          ...seed,
          id: 'scale-' + index,
          order: index,
          sequenceNo: index + 1,
          rawContent: {
            ...body,
            messages: [{ ...body.messages[0]!, text: index + ':' + text + ':END-' + index }]
          }
        }
      }
      const metadata = { ...base, records: Array.from({ length: count }, (_, i) => recordMetadata(row(i))) }
      async function* records() {
        for (let i = 0; i < count; i++) {
          memory()
          yield row(i)
        }
      }
      const path = join(work, `public-${count}.${format}`),
        handle = await open(path, 'wx')
      const started = performance.now(),
        outputHash = createHash('sha256')
      const maximumBytes = (count + 4) * 2 * MiB
      const sink = async (bytes: Uint8Array) => {
        assert(bytes.length <= 256 * 1024)
        let offset = 0
        while (offset < bytes.length) {
          const written = (await handle.write(bytes, offset, bytes.length - offset)).bytesWritten
          if (!written) throw new Error('short write')
          offset += written
        }
        outputHash.update(bytes)
        memory()
      }
      let proof
      try {
        if (format === 'deflate') {
          const pending: Uint8Array[] = [],
            compressedHash = createHash('sha256')
          let size = 0
          const zip = new Zip((error, bytes) => {
            if (error) throw error
            pending.push(bytes)
          })
          const entry = new ZipDeflate('backup.json', { level: 6 })
          zip.add(entry)
          async function drain() {
            for (const bytes of pending.splice(0)) {
              for (let start = 0; start < bytes.length; start += 256 * 1024)
                await sink(bytes.subarray(start, start + 256 * 1024))
              size += bytes.length
              compressedHash.update(bytes)
            }
          }
          try {
            await writeBackupJsonStream(
              metadata,
              records(),
              async (bytes) => {
                entry.push(bytes, false)
                await drain()
              },
              { maximumBytes }
            )
            entry.push(new Uint8Array(), true)
            zip.end()
            await drain()
            proof = { bytes: size, sha256: compressedHash.digest('hex') }
          } finally {
            zip.terminate()
          }
        } else
          proof =
            format === 'json'
              ? await writeBackupJsonStream(metadata, records(), sink, { maximumBytes })
              : await writeBackupZipStream(metadata, records(), [], sink, { maximumBytes })
        await handle.sync()
      } finally {
        await handle.close()
      }
      const file = await stat(path)
      if (format !== 'deflate') assert(file.size > 64 * MiB)
      assert.equal(proof.bytes, file.size)
      assert.equal(proof.sha256, outputHash.digest('hex'))
      let seen = 0
      const inputHash = createHash('sha256')
      async function* source() {
        for await (const bytes of createReadStream(path, { highWaterMark: 64 * 1024 })) {
          inputHash.update(bytes)
          memory()
          yield bytes
        }
      }
      const options = {
        maximumBytes,
        expectedSource: proof,
        stageRecord: async (record: SessionRecord, index: number) => {
          assert.equal(index, seen)
          assert.deepEqual(record, row(index))
          seen++
          memory()
        }
      }
      const preview =
        format === 'json'
          ? await readBackupJsonStream(source(), options)
          : await readBackupZipStream(source(), { ...options, maximumExpandedBytes: maximumBytes })
      assert.equal(seen, count)
      assert.equal(preview.offlineRecords, count)
      if (format !== 'json') assert('expandedBytes' in preview && Number(preview.expandedBytes) > 64 * MiB)
      assert.equal(inputHash.digest('hex'), proof.sha256)
      assert.deepEqual(preview.metadata, metadata)
      assert(!JSON.stringify(preview.metadata).includes('rawContent'))
      console.log(
        JSON.stringify({
          kind: 'public-stream-scale',
          format,
          records: count,
          fileBytes: file.size,
          sha256: proof.sha256,
          heapLimitMiB: 96,
          peakHeapMiB: +(peakHeap / MiB).toFixed(2),
          peakExternalMiB: +(peakExternal / MiB).toFixed(2),
          peakRssMiB: +(peakRss / MiB).toFixed(2),
          seconds: +((performance.now() - started) / 1000).toFixed(2),
          everyBodyEqual: true,
          nativeAcceptance: false
        })
      )
      await unlink(path)
      global.gc?.()
    }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
