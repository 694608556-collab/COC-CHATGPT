import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { rgbReferenceRows } from '../tests/png-rgb-reference'
import { searchSample } from '../src/dev/sample'
import { expandModules } from './helpers'

/** @param page - 全新隔离上下文。 @returns 导入 151 页公开正文并打开 PDF 确认框；不访问用户数据。 */
async function openLongPdf(
  page: Page,
  mode: 'single' | 'combined' | 'batch' = 'single',
  bodyLineCount = 6299
) {
  const sample = searchSample()
  sample.modules = [{ ...sample.modules[0]!, name: '完整 PDF 公开回归', collapsed: false }]
  sample.characters = []
  sample.records = [
    {
      ...sample.records[0]!,
      name: `${Math.ceil((bodyLineCount + 2) / 42)} 页完整中文`,
      sourceType: 'manual',
      rawContent: undefined,
      manualContent: [
        '首行：探索开始 FIRST',
        ...Array.from({ length: bodyLineCount }, (_, i) => `公开正文 ${i + 1}：调查员记录每一次探索。`),
        '末行：探索结束 LAST'
      ].join('\n')
    }
  ]
  if (mode !== 'single') {
    const body = sample.records[0]!.manualContent!.split('\n')
    sample.records = Array.from({ length: mode === 'batch' ? 76 : 2 }, (_, i) => ({
      ...sample.records[0]!,
      id: 'public-pdf-' + i,
      order: i,
      sequenceNo: i + 1,
      name: '公开 PDF 场次 ' + (i + 1),
      manualContent:
        mode === 'batch'
          ? [`场次 ${i + 1} 的唯一公开正文`, ...body.slice(1, 20)].join('\n')
          : (i ? body.slice(3150) : body.slice(0, 3150)).join('\n')
    }))
  }
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-pdf.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  if (mode === 'single') {
    await page.getByRole('button', { name: /完整 PDF 公开回归.*\d+ 页完整中文/ }).click()
    await page.getByRole('button', { name: '更多导出格式' }).click()
  } else {
    await page.getByRole('button', { name: '全选此模组', exact: true }).click()
    await page.getByRole('button', { name: mode === 'batch' ? '批量导出' : '合成导出', exact: true }).click()
  }
  await page.getByRole('combobox', { name: '文件格式', exact: true }).click()
  await page.getByRole('option', { name: 'PDF', exact: true }).click()
}

test('超过 150 页生成一个完整 PDF，期间显示真实页数进度且能响应', async ({ page }, info) => {
  test.setTimeout(90000)
  await openLongPdf(page)
  await page.evaluate(() => {
    const gaps: number[] = []
    let last = performance.now()
    Object.assign(window, {
      pdfGaps: gaps,
      pdfTimer: setInterval(() => {
        const now = performance.now()
        gaps.push(now - last)
        last = now
      }, 16)
    })
  })
  await page.getByRole('button', { name: '保存导出文件' }).click()
  await expect(page.getByRole('dialog', { name: '导出日志' }).getByRole('progressbar')).toContainText(
    /\d+\/151/
  )
  await expect(page.getByRole('status')).toContainText('1 个文件', { timeout: 60000 })
  const gaps = await page.evaluate(() => {
    const measured = window as unknown as { pdfTimer: number; pdfGaps: number[] }
    clearInterval(measured.pdfTimer)
    return measured.pdfGaps
  })
  expect(gaps.length).toBeGreaterThan(30)
  expect(Math.max(...gaps)).toBeLessThan(500)
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText(/测试文件（/).click()
  const file = page.getByRole('button', { name: /151 页完整中文\.pdf$/ })
  await expect(file).toHaveCount(1)
  const downloaded = page.waitForEvent('download')
  await file.click()
  const download = await downloaded
  await download.saveAs(info.outputPath('complete-151.pdf'))
  const pdf = await readFile((await download.path())!)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(151)
  expect(pdf.subarray(-32).toString()).toContain('%%EOF')
  // 固定公开密集中文样本的文件预算，避免把逐页图像再次膨胀为旧版约 46 MB。
  expect(pdf.length).toBeLessThan(24 * 1024 * 1024)
})

test('76 场批量 PDF 显示真实文件/页进度并完整保存全部 76 个文件', async ({ page }) => {
  test.setTimeout(90000)
  await openLongPdf(page, 'batch')
  await page.getByRole('button', { name: '保存导出文件' }).click()
  await expect(page.getByRole('dialog', { name: '导出日志' }).getByRole('progressbar')).toContainText(
    /文件 \d+\/76/
  )
  await expect(page.getByRole('status')).toContainText('76 个文件', { timeout: 60000 })
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await expect(page.getByText('测试文件（76）', { exact: true })).toBeVisible()
  await page.getByText('测试文件（76）', { exact: true }).click()
  const firstDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /公开 PDF 场次 1\.pdf$/ }).click()
  const first = await readFile((await (await firstDownload).path())!)
  const lastDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: /公开 PDF 场次 76\.pdf$/ }).click()
  const last = await readFile((await (await lastDownload).path())!)
  expect(first.equals(last)).toBe(false)
})

test('多个场次合成超过 150 页仍保存一个 PDF', async ({ page }) => {
  test.setTimeout(90000)
  await openLongPdf(page, 'combined')
  await page.getByRole('button', { name: '保存导出文件' }).click()
  await expect(page.getByRole('status')).toContainText('1 个文件', { timeout: 60000 })
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText('测试文件（1）', { exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: /完整 PDF 公开回归.*\.pdf$/ }).click()
  const pdf = await readFile((await (await downloaded).path())!)
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)!.length).toBeGreaterThan(150)
})

test('导出读到陈旧版本时弹窗内明确失败，关闭后可重试且不发布文件', async ({ page }) => {
  test.setTimeout(60000)
  await openLongPdf(page, 'combined')
  const writer = await page.context().newPage()
  await writer.goto('/')
  await writer.getByRole('button', { name: '模组 完整 PDF 公开回归', exact: true }).dblclick()
  await writer.getByLabel('模组名称', { exact: true }).fill('公开的新版本模组')
  await writer.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(writer.getByRole('button', { name: '模组 公开的新版本模组', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存导出文件' }).click()
  const dialog = page.getByRole('dialog', { name: '导出日志' })
  await expect(dialog.getByRole('alert')).toContainText('数据已变化')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await expect(page.getByText('测试文件（0）', { exact: true })).toBeVisible()
  await writer.close()
  await page.reload()
  await expandModules(page)
  await page.getByRole('button', { name: '全选此模组', exact: true }).click()
  await page.getByRole('button', { name: '合成导出', exact: true }).click()
  await page.getByRole('combobox', { name: '文件格式', exact: true }).click()
  await page.getByRole('option', { name: 'PDF', exact: true }).click()
  await page.getByRole('button', { name: '保存导出文件' }).click()
  await expect(page.getByRole('status')).toContainText('1 个文件', { timeout: 30000 })
})

test('逐页导出中取消及时响应，不发布半成品、不生成副本，正文仍可阅读并能重新导出', async ({ page }) => {
  await openLongPdf(page)
  await page.getByRole('button', { name: '保存导出文件' }).click()
  await expect(page.getByRole('dialog', { name: '导出日志' }).getByRole('progressbar')).toContainText(
    /\d+\/151/
  )
  await page.getByRole('button', { name: '取消导出', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已取消 PDF 导出', { timeout: 2000 })
  await expect(page.getByRole('dialog', { name: '导出日志' })).toHaveCount(0)
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await expect(page.getByText('测试文件（0）', { exact: true })).toBeVisible()
  await expect(page.getByText(/首行：探索开始 FIRST/).last()).toBeVisible()
  await page.getByRole('button', { name: '更多导出格式' }).click()
  await page.getByRole('button', { name: '保存导出文件' }).click()
  await expect(page.getByRole('status')).toContainText('1 个文件')
})

test('RGBA原生画布通过实际Worker生成完整PDF，每页RGB像素与原画布逐字节一致', async ({ page }, info) => {
  test.setTimeout(60000)
  await openLongPdf(page, 'single', 84)
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob
    const hashes: string[] = [],
      colors: number[] = []
    Object.assign(window, { publicPdfPixelHashes: hashes, publicPdfColorTypes: colors })
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type !== 'image/png' || this.width !== 1754) return original.call(this, callback, type, quality)
      const copy = document.createElement('canvas')
      copy.width = this.width
      copy.height = this.height
      const ctx = copy.getContext('2d', { alpha: true })!
      ctx.drawImage(this, 0, 0)
      const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data
      const rgb = new Uint8Array((copy.width * 3 + 1) * copy.height)
      for (let y = 0; y < copy.height; y++)
        for (let x = 0; x < copy.width; x++) {
          const source = (y * copy.width + x) * 4,
            destination = y * (copy.width * 3 + 1) + 1 + x * 3
          if (pixels[source + 3] !== 255) throw Error('Public canvas must remain opaque')
          rgb.set(pixels.subarray(source, source + 3), destination)
        }
      return original.call(
        copy,
        async (blob) => {
          if (!blob) {
            callback(null)
            return
          }
          const header = new Uint8Array(await blob.slice(0, 33).arrayBuffer())
          colors.push(header[25]!)
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', rgb))
          hashes.push(Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''))
          callback(blob)
        },
        type,
        quality
      )
    }
  })
  await page.getByRole('button', { name: '保存导出文件' }).click()
  await expect(page.getByRole('status')).toContainText('1 个文件', { timeout: 30000 })
  await page.getByRole('button', { name: '刷新测试文件列表' }).click()
  await page.getByText('测试文件（1）', { exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: /3 页完整中文\.pdf$/ }).click()
  const file = await downloaded
  await file.saveAs(info.outputPath('rgba-pixel-proof.pdf'))
  const pdf = await readFile((await file.path())!)
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(3)
  const expected = await page.evaluate(() => ({
    hashes: (window as any).publicPdfPixelHashes as string[],
    colors: (window as any).publicPdfColorTypes as number[]
  }))
  expect(expected.colors).toEqual([6, 6, 6])
  const pattern = /\/Subtype \/Image[\s\S]*?\/Length (\d+) >>\nstream\n/g
  const hashes: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(pdf.toString('latin1')))) {
    const start = match.index + match[0].length
    const pixels = inflateSync(pdf.subarray(start, start + Number(match[1])))
    hashes.push(
      createHash('sha256')
        .update(rgbReferenceRows(pixels, 1754, 1240))
        .digest('hex')
    )
  }
  expect(hashes).toEqual(expected.hashes)
  expect(pdf.subarray(-32).toString()).toContain('%%EOF')
})
