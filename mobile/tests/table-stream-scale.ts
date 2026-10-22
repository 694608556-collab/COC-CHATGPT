import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, closeSync, openSync, statfsSync, statSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseSync } from 'node:sqlite'
import { Zip, ZipPassThrough } from 'fflate'
import { readTableGridStream, type TableGridStreamOptions } from '../src/data/table-grid-stream'

async function main() {
  const [work, format, countText] = process.argv.slice(2)
  assert(work && (format === 'csv' || format === 'xlsx'))
  const targetMiB = Number(countText)
  assert(Number.isSafeInteger(targetMiB) && targetMiB > 0)
  const MiB = 1024 * 1024
  const rowBytes = format === 'xlsx' ? 32 * 1024 : MiB
  const rows = (targetMiB * MiB) / rowBytes
  const sourcePath = join(work, `public-${format}.${format}`)
  const indexPath = join(work, `strings-${format}.sqlite`)
  const available = statfsSync(work)
  assert(
    available.bavail * available.bsize > rows * rowBytes * 3 + 128 * MiB,
    'Insufficient actual temporary disk space for this fixture'
  )

  let peakHeap = 0
  let peakRss = 0
  let peakExternal = 0
  const sample = () => {
    const memory = process.memoryUsage()
    peakHeap = Math.max(peakHeap, memory.heapUsed)
    peakRss = Math.max(peakRss, memory.rss)
    peakExternal = Math.max(peakExternal, memory.external)
  }
  function body(index: number) {
    const prefix = `PUBLIC ROW ${index} 开始\nquoted "value" and ampersand & angle <\n`
    const suffix = `\nEND ROW ${index} 完整正文 😀`
    return (
      prefix +
      '0123456789abcdef'
        .repeat(Math.ceil((rowBytes - Buffer.byteLength(prefix + suffix)) / 16))
        .slice(0, rowBytes - Buffer.byteLength(prefix + suffix)) +
      suffix
    )
  }
  function escapeXml(text: string) {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  }
  function digest(text: string) {
    return createHash('sha256').update(text).digest('hex')
  }

  const fixtureStart = performance.now()
  const sourceHash = createHash('sha256')
  let sourceBytes = 0
  const output = openSync(sourcePath, 'wx')
  function write(bytes: Uint8Array) {
    sourceHash.update(bytes)
    sourceBytes += bytes.length
    let position = 0
    while (position < bytes.length) position += writeSync(output, bytes, position, bytes.length - position)
  }
  try {
    if (format === 'csv') {
      write(Buffer.from('\ufeff模组名,场次名,手动保存内容\r\n'))
      for (let row = 0; row < rows; row++) {
        write(Buffer.from(`Public,Session ${row},"${body(row).replaceAll('"', '""')}"\r\n`))
        sample()
      }
    } else {
      let finished = false
      const zip = new Zip((error, bytes, final) => {
        if (error) throw error
        write(bytes)
        if (final) finished = true
      })
      function part(name: string, chunks: Iterable<string>) {
        const file = new ZipPassThrough(name)
        zip.add(file)
        for (const text of chunks) {
          const bytes = Buffer.from(text)
          for (let offset = 0; offset < bytes.length; offset += 64 * 1024)
            file.push(bytes.subarray(offset, offset + 64 * 1024))
        }
        file.push(new Uint8Array(), true)
      }
      const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
      const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
      part('[Content_Types].xml', [
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/public.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'
      ])
      part('_rels/.rels', [
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${relationship}officeDocument" Target="xl/workbook.xml"/></Relationships>`
      ])
      part('xl/workbook.xml', [
        `<workbook xmlns="${spreadsheet}" xmlns:r="${relationship}"><sheets><sheet name="Public" sheetId="1" r:id="s1"/></sheets></workbook>`
      ])
      part('xl/_rels/workbook.xml.rels', [
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="s1" Type="${relationship}worksheet" Target="worksheets/public.xml"/><Relationship Id="sst" Type="${relationship}sharedStrings" Target="sharedStrings.xml"/></Relationships>`
      ])
      function* worksheet() {
        yield `<worksheet xmlns="${spreadsheet}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>模组名</t></is></c><c r="B1" t="inlineStr"><is><t>场次名</t></is></c><c r="C1" t="inlineStr"><is><t>手动保存内容</t></is></c></row>`
        for (let row = 0; row < rows; row++) {
          yield `<row r="${row + 2}"><c r="A${row + 2}" t="inlineStr"><is><t>Public</t></is></c><c r="B${row + 2}" t="inlineStr"><is><t>Session ${row}</t></is></c><c r="C${row + 2}" t="s"><v>${row}</v></c></row>`
        }
        yield '</sheetData></worksheet>'
      }
      // Put SST after the worksheet: local ZIP order cannot be assumed.
      part('xl/worksheets/public.xml', worksheet())
      function* strings() {
        yield `<sst xmlns="${spreadsheet}" count="${rows}" uniqueCount="${rows}">`
        for (let row = 0; row < rows; row++) {
          yield `<si><t xml:space="preserve">${escapeXml(body(row))}</t></si>`
          sample()
        }
        yield '</sst>'
      }
      part('xl/sharedStrings.xml', strings())
      zip.end()
      assert(finished)
    }
  } finally {
    closeSync(output)
  }
  const expectedSource = { bytes: sourceBytes, sha256: sourceHash.digest('hex') }
  assert.equal(statSync(sourcePath).size, sourceBytes)
  global.gc?.()
  sample()

  const database = new DatabaseSync(indexPath)
  database.exec(
    'PRAGMA journal_mode=DELETE; PRAGMA temp_store=FILE; PRAGMA cache_size=-4096; CREATE TABLE strings(id INTEGER PRIMARY KEY, value TEXT NOT NULL); BEGIN IMMEDIATE;'
  )
  const put = database.prepare('INSERT INTO strings(id,value) VALUES (?,?)')
  const get = database.prepare('SELECT value FROM strings WHERE id=?')
  let stringCount = 0
  let sourcePulls = 0
  let sourcePasses = 0
  let sourceReadBytes = 0
  let readChunkMaximum = 0
  let callbacksInFlight = 0
  let pauses = 0
  async function acknowledge(operation: () => void, shouldPause: boolean) {
    assert.equal(callbacksInFlight, 0, 'Callbacks must honor sequential ACK backpressure')
    callbacksInFlight++
    try {
      operation()
      if (shouldPause) {
        const before = sourcePulls
        await new Promise((resolve) => setTimeout(resolve, 2))
        assert.equal(sourcePulls, before, 'Source advanced while consumer ACK was pending')
        pauses++
      }
      sample()
    } finally {
      callbacksInFlight--
    }
  }
  let actualRows = 0
  let starts = 0
  let ends = 0
  let verifiedBodyBytes = 0
  const completeBodyHash = createHash('sha256')
  const expectedBodyHash = createHash('sha256')
  const maximumExpandedBytes = available.bavail * available.bsize
  const options: TableGridStreamOptions = {
    name: `public.${format}`,
    format,
    expectedSource,
    maximumExpandedBytes,
    async *source() {
      sourcePasses++
      for await (const chunk of createReadStream(sourcePath, { highWaterMark: 64 * 1024 })) {
        assert.equal(callbacksInFlight, 0)
        sourcePulls++
        sourceReadBytes += chunk.length
        readChunkMaximum = Math.max(readChunkMaximum, chunk.length)
        sample()
        yield chunk as Buffer
      }
    },
    async writeString(index, value) {
      await acknowledge(
        () => {
          assert.equal(index, stringCount++)
          put.run(index, value)
        },
        index % 64 === 0
      )
    },
    async readString(index) {
      let value: string | undefined
      await acknowledge(
        () => {
          value = get.get(index)?.value as string | undefined
          assert.equal(typeof value, 'string')
        },
        index % 64 === 0
      )
      return value!
    },
    async onSheetStart(info) {
      assert.equal(info.order, 0)
      assert.equal(starts++, 0)
    },
    async onRow(row) {
      await acknowledge(
        () => {
          if (!actualRows) assert.deepEqual(row.values, ['模组名', '场次名', '手动保存内容'])
          else {
            const index = actualRows - 1
            assert.equal(row.index, actualRows)
            assert.equal(row.values[0], 'Public')
            assert.equal(row.values[1], `Session ${index}`)
            assert.equal(typeof row.values[2], 'string')
            const actual = row.values[2] as string
            const expected = body(index)
            assert.equal(Buffer.byteLength(actual), rowBytes)
            assert.equal(
              digest(actual),
              digest(expected),
              'Complete body SHA-256 must survive CSV/XML/SST transformations'
            )
            completeBodyHash.update(actual)
            expectedBodyHash.update(expected)
            verifiedBodyBytes += Buffer.byteLength(actual)
          }
          actualRows++
        },
        actualRows % 16 === 0
      )
    },
    async onSheetEnd() {
      ends++
    }
  }
  const parseStart = performance.now()
  try {
    await readTableGridStream(options)
    database.exec('COMMIT')
    assert.equal(actualRows, rows + 1)
    assert.equal(starts, 1)
    assert.equal(ends, 1)
    assert.equal(verifiedBodyBytes, rows * rowBytes)
    const bodiesSha256 = completeBodyHash.digest('hex')
    assert.equal(bodiesSha256, expectedBodyHash.digest('hex'))
    assert.equal(
      sourceReadBytes,
      sourcePasses * sourceBytes,
      'Every parser pass must consume and verify the entire immutable source'
    )
    assert(pauses > 0)
    assert(readChunkMaximum <= 64 * 1024)
    const elapsedMs = performance.now() - parseStart
    sample()
    console.log(
      JSON.stringify({
        kind: 'public-table-stream-scale',
        host: `${process.platform}/${process.arch}`,
        node: process.version,
        format,
        heapLimitMiB: 96,
        sourceBytes,
        sourceSha256: expectedSource.sha256,
        rows,
        verifiedBodyBytes,
        bodiesSha256,
        stringIndexBytes: statSync(indexPath).size,
        stringCount,
        sourcePasses,
        sourceReadBytes,
        readChunkMaximum,
        pausedAcknowledgements: pauses,
        generationMs: Math.round(parseStart - fixtureStart),
        parseMs: Math.round(elapsedMs),
        peakHeapBytes: peakHeap,
        peakRssBytes: Math.max(peakRss, process.resourceUsage().maxRSS * 1024),
        peakExternalBytes: peakExternal,
        scope:
          'shared CSV/XLSX parser and real temporary Node SQLite SST; not phone/native transaction acceptance'
      })
    )
  } finally {
    database.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
