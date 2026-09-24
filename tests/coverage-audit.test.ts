// 完整性核对：文件里所有 <tp> 文字 vs 我的解析器提取到的文字
import fs from 'node:fs'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseEmmx } from '../src/shared/emmx'
import { samplePath } from './sample-files'

function entries(buf: Buffer) {
  const list: Array<{ name: string; method: number; compressedSize: number; dataStart: number }> = []
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue
    const nl = buf.readUInt16LE(i + 26)
    const el = buf.readUInt16LE(i + 28)
    if (!nl || nl > 512) continue
    const name = buf.subarray(i + 30, i + 30 + nl).toString('utf8')
    if (!name || name.includes(String.fromCharCode(0))) continue
    list.push({
      name,
      method: buf.readUInt16LE(i + 8),
      compressedSize: buf.readUInt32LE(i + 18),
      dataStart: i + 30 + nl + el
    })
  }
  return list
}

const FILES = [
  samplePath('龙台掠雪'),
  samplePath('锈蚀纪元'),
  samplePath('渊娲之海'),
  samplePath('月廻上')
].filter((value): value is string => Boolean(value))

describe('text coverage audit', () => {
  for (const file of FILES) {
    it.skipIf(!fs.existsSync(file))(`extracts every text of ${file.split('\\').pop()}`, () => {
      const buf = fs.readFileSync(file)
      const pages = entries(buf).filter((e) => /^page\/page.*\.xml$/.test(e.name))

      // 按「每个 Shape 的文字」为口径统计，与解析器一致：
      // 一个 Shape 里的多个 <tp> 会合并成一段（解析器就是这么做的），
      // 若按单个 <tp> 计数，同一段被拆成 5 个 <tp> 时会误判为「缺 4 段」。
      //
      // 另外要解码 XML 实体：文件里存的是 &quot;要离开了” ，而解析器输出的是
      // 解码后的 "要离开了” ，不解码就会把这段误报成「缺失」。
      const decode = (value: string): string =>
        value
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
          .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
          .replace(/&amp;/g, '&')

      const perShape: string[] = []
      for (const page of pages) {
        const raw = buf.subarray(page.dataStart, page.dataStart + page.compressedSize)
        const xml = (page.method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8')
        for (const shape of xml.matchAll(/<Shape\s+ID="\d+"\s+Type="[^"]+"[^>]*>([\s\S]*?)<\/Shape>/g)) {
          const text = [...shape[1]!.matchAll(/<tp\b[^>]*>([\s\S]*?)<\/tp>/g)]
            .map((m) => decode(m[1]!.replace(/<[^>]+>/g, '')).trim())
            .filter(Boolean)
            .join(' ')
          if (text) perShape.push(text)
        }
      }

      const document = parseEmmx(buf)
      // 图形提取 + 标签，应当覆盖文件里的每一段文字
      const extracted = new Set<string>()
      for (const page of document.pages) {
        for (const shape of page.shapes) if (shape.lines.length) extracted.add(shape.lines.join(' '))
        for (const label of page.labels) if (label.lines.length) extracted.add(label.lines.join(' '))
      }
      const missing = perShape.filter((text) => !extracted.has(text))

      // 大纲同样要覆盖全部文字
      const outlineTexts = new Set(document.outline.map((line) => line.text))
      const missingFromOutline = perShape.filter((text) => !outlineTexts.has(text))

      // 硬指标：图形提取与大纲都不允许有缺口
      expect(missing, `图形提取缺失 ${missing.length} 段: ${missing.slice(0, 3).join(' / ')}`).toEqual([])
      expect(
        missingFromOutline,
        `大纲缺失 ${missingFromOutline.length} 段: ${missingFromOutline.slice(0, 3).join(' / ')}`
      ).toEqual([])
    })
  }
})
