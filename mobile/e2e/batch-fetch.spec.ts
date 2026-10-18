import { expect, test } from '@playwright/test'
import { zlibSync } from 'fflate'
import { searchSample } from '../src/dev/sample'
import { expandModules } from './helpers'
import type { Page } from '@playwright/test'

/** @param page - 全新浏览器上下文的页面。 @param keepFirstBody - 为失败保留测试预存第一场正文。 @returns 导入五场公开样本并展示列表，不接触用户预览。 */
async function openBatchSample(page: Page, keepFirstBody = false) {
  const sample = searchSample()
  sample.modules = [{ ...sample.modules[0]!, name: '公开批量回归', collapsed: false }]
  sample.records = Array.from({ length: 5 }, (_, i) => ({
    ...sample.records[0]!,
    id: 'batch-public-' + i,
    name: '公开场次 ' + (i + 1),
    order: i,
    sequenceNo: i + 1,
    rawContent:
      keepFirstBody && i === 0
        ? {
            parserVersion: 1,
            sourceUrl: 'https://log.weizaima.com/?key=batch-public-0',
            messages: [
              {
                id: 'old-message',
                order: 0,
                displayName: '公开主持人',
                text: '获取失败仍保留的旧正文',
                type: 'text',
                images: [],
                isDiceCommand: false,
                isOffTopic: false
              }
            ]
          }
        : undefined,
    status: 'pending',
    link: 'https://log.weizaima.com/?key=batch-public-' + i
  }))
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '选择并确认保存位置' }).click()
  await page.getByRole('button', { name: '数据与设置', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择备份并预览' }).click()
  await (
    await chooser
  ).setFiles({
    name: 'public-batch.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sample))
  })
  await page.getByRole('button', { name: '确认覆盖并导入' }).click()
  await expect(page.getByRole('status')).toContainText('导入完成')
  await page.getByRole('button', { name: '跑团记录', exact: true }).click()
  await expandModules(page)
  return sample
}

test('五场获取同时最多三请求，中途显示真实完成数量，全部结束后一次保存并重开保留', async ({ page }) => {
  await openBatchSample(page)
  const release: Array<() => void> = []
  let active = 0
  let peak = 0
  const payload = JSON.stringify({
    data: Buffer.from(
      zlibSync(
        new TextEncoder().encode(
          JSON.stringify({
            messages: [{ nickname: '公开主持人', content: '完整公开批量正文' }]
          })
        )
      )
    ).toString('base64')
  })
  await page.route('**/_logbook/sea?*', async (route) => {
    active++
    peak = Math.max(peak, active)
    await new Promise<void>((resolve) => release.push(resolve))
    try {
      await route.fulfill({
        json: { status: 200, url: 'https://dice-api.weizaima.com/dice/api/load_data', text: payload }
      })
    } finally {
      active--
    }
  })
  try {
    await page.getByRole('button', { name: '全选此模组', exact: true }).click()
    await page.getByRole('button', { name: '获取所选在线正文', exact: true }).click()
    await expect.poll(() => release.length, { timeout: 1500 }).toBe(3)
    release[0]!()
    release[1]!()
    await expect.poll(() => release.length).toBe(5)
    await expect(page.getByRole('progressbar', { name: '数据处理进度' })).toContainText('2/5')
    await expect(page.getByRole('progressbar', { name: '数据处理进度' })).toContainText('成功 2')
    expect(peak).toBe(3)
    const observer = await page.context().newPage()
    await observer.goto('/')
    await expandModules(observer)
    await expect(observer.getByText('正文已保存', { exact: true })).toHaveCount(0)
    release.forEach((finish) => finish())
    await expect(page.getByRole('status')).toContainText('获取完成：5 个成功，0 个失败')
    await expect(page.getByText('正文已保存', { exact: true })).toHaveCount(5)
    await observer.reload()
    await expandModules(observer)
    await expect(observer.getByText('正文已保存', { exact: true })).toHaveCount(5)
    await observer.close()
    await page.reload()
    await expandModules(page)
    await expect(page.getByText('正文已保存', { exact: true })).toHaveCount(5)
    expect(peak).toBe(3)
  } finally {
    release.forEach((finish) => finish())
  }
})

test('部分网络失败仍保留旧正文，其他成功正文完整保存', async ({ page }) => {
  await openBatchSample(page, true)
  const payload = JSON.stringify({ messages: [{ nickname: '公开主持人', content: '本次成功的公开正文' }] })
  await page.route('**/_logbook/sea?*', (route) =>
    route.fulfill({
      json: {
        status: route.request().url().includes('batch-public-0') ? 503 : 200,
        url: 'https://dice-api.weizaima.com/dice/api/load_data',
        text: payload
      }
    })
  )
  await page.getByRole('button', { name: '全选此模组', exact: true }).click()
  await page.getByRole('button', { name: '获取所选在线正文', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('获取完成：4 个成功，1 个失败')
  await page.reload()
  await expandModules(page)
  await page.getByRole('button', { name: /公开批量回归 公开场次 1 正文已保存/ }).click()
  await expect(page.getByText('获取失败仍保留的旧正文', { exact: true })).toBeVisible()
})

test('获取中另一页面修改后整批拒绝，不提交部分正文也不覆盖新数据', async ({ page, context }) => {
  await openBatchSample(page)
  const release: Array<() => void> = []
  const payload = JSON.stringify({ messages: [{ nickname: '公开主持人', content: '不得部分提交的正文' }] })
  await page.route('**/_logbook/sea?*', async (route) => {
    await new Promise<void>((resolve) => release.push(resolve))
    await route.fulfill({
      json: { status: 200, url: 'https://dice-api.weizaima.com/dice/api/load_data', text: payload }
    })
  })
  const other = await context.newPage()
  try {
    await page.getByRole('button', { name: '全选此模组', exact: true }).click()
    await page.getByRole('button', { name: '获取所选在线正文', exact: true }).click()
    await expect.poll(() => release.length).toBe(3)
    await other.goto('/')
    await other.getByRole('button', { name: '新增模组', exact: true }).click()
    await other.getByLabel('模组名称', { exact: true }).fill('获取期间另一处保存的模组')
    await other.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(other.getByRole('status', { name: '普通保存状态' })).toHaveText('已保存')
    release.forEach((finish) => finish())
    await expect.poll(() => release.length).toBe(5)
    release.forEach((finish) => finish())
    await expect(page.getByRole('alert')).toContainText('数据已变化')
    await page.reload()
    await expandModules(page)
    await expect(
      page.getByRole('button', { name: '模组 获取期间另一处保存的模组', exact: true })
    ).toBeVisible()
    await expect(page.getByText('正文已保存', { exact: true })).toHaveCount(0)
  } finally {
    release.forEach((finish) => finish())
    await other.close()
  }
})

test('大正文批量处理时动画仍能更新，后台解析不占用长时间界面帧（桌面六倍降速）', async ({ page }) => {
  test.setTimeout(60000)
  await openBatchSample(page)
  const payload = JSON.stringify({
    data: Buffer.from(
      zlibSync(
        new TextEncoder().encode(
          JSON.stringify({
            messages: Array.from({ length: 10000 }, (_, i) => ({
              nickname: '公开主持人',
              content: '完整正文 ' + i
            }))
          })
        )
      )
    ).toString('base64')
  })
  await page.route('**/_logbook/sea?*', (route) =>
    route.fulfill({
      json: { status: 200, url: 'https://dice-api.weizaima.com/dice/api/load_data', text: payload }
    })
  )
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.getByRole('button', { name: '全选此模组', exact: true }).click()
  await page.evaluate(() => {
    const state = {
      last: performance.now(),
      max: 0,
      count: 0,
      running: true,
      gaps: [] as Array<{ gap: number; stage: string }>
    }
    Object.assign(window, { batchFrames: state })
    /** @param time - 当前动画帧毫秒时间。 @returns 无返回值；仅记录公开操作期间界面帧间隔。 */
    function frame(time: number) {
      if (!state.running) return
      if (time - state.last > 200)
        state.gaps.push({
          gap: time - state.last,
          stage: document.querySelector('.operation-feedback')?.textContent ?? ''
        })
      state.max = Math.max(state.max, time - state.last)
      state.last = time
      state.count++
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  await page.getByRole('button', { name: '获取所选在线正文', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('获取完成：5 个成功，0 个失败', { timeout: 45000 })
  const frames = await page.evaluate(() => {
    const state = (
      window as unknown as { batchFrames: { max: number; count: number; running: boolean; gaps: unknown[] } }
    ).batchFrames
    state.running = false
    return { max: state.max, count: state.count, gaps: state.gaps }
  })
  console.log(JSON.stringify({ environment: 'Desktop Chrome 6x CPU, not S9', ...frames }))
  expect(frames.count).toBeGreaterThan(15)
  expect(frames.max).toBeLessThan(500)
})
