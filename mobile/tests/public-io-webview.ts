import { Capacitor } from '@capacitor/core'
import { Native } from '../src/data/native'
import type { SavedDocument } from '../src/data/native'

declare global {
  interface Window {
    __publicIoDocuments?: Record<string, SavedDocument>
    __publicIoConfig: { mode: string }
    __publicIoSource: string
    __publicIoResult: unknown
    __publicIoStage: string
  }
}
const results: Array<{
  operation: string
  totalMs: number
  nativeCalls: Array<{ method: string; milliseconds: number }>
}> = []
const published: SavedDocument[] = []
let confirmations: ReturnType<typeof setInterval> | undefined
let delayNextStageForCancellation = false
let delayedCancellationStage: Promise<void> | undefined
let calls: Array<{ method: string; milliseconds: number }> = []
const cap = (
  window as unknown as {
    Capacitor: { nativePromise(plugin: string, method: string, options: unknown): Promise<unknown> }
  }
).Capacitor
const nativePromise = cap.nativePromise.bind(cap)
cap.nativePromise = async (plugin, method, options) => {
  if (plugin === 'Logbook' && method === 'openBackup') {
    const selected =
      published.find((file) => file.name === window.__publicIoSource) ??
      window.__publicIoDocuments?.[window.__publicIoSource]
    if (Capacitor.getPlatform() === 'ios') {
      check(selected, 'Only registered public iOS fixtures may be selected')
      options = { ...(options as object), publicRestoreDocument: selected.uri }
    } else {
      ;(window as unknown as { PublicIoChoice: { select(name: string): void } }).PublicIoChoice.select(
        selected?.uri ?? window.__publicIoSource
      )
    }
  }
  const start = performance.now()
  try {
    const result = await nativePromise(plugin, method, options)
    if (plugin === 'Logbook' && method === 'appendTableStage' && delayNextStageForCancellation) {
      delayNextStageForCancellation = false
      delayedCancellationStage = new Promise((resolve) => setTimeout(resolve, 1500))
      await delayedCancellationStage
    }
    if (
      plugin === 'Logbook' &&
      ['writeArchive', 'finishExportArchive', 'finishPdfArchive', 'finishBackupExport'].includes(method)
    )
      published.push(result as SavedDocument)
    if (plugin === 'Logbook' && method === 'automaticBackup')
      published.push((result as { document: SavedDocument }).document)
    return result
  } finally {
    if (plugin === 'Logbook') calls.push({ method, milliseconds: performance.now() - start })
  }
}
/** @param ok Public fixture invariant. @param message Failure reason without user data. @returns No value; throws on failure. */
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message)
}
/** @param predicate Observable UI completion. @param message Stage label. @returns Resolves with the first truthy result; timeout fails the test. */
async function waitFor<T>(predicate: () => T, message: string): Promise<NonNullable<T>> {
  const deadline = performance.now() + 120000
  for (;;) {
    const value = predicate()
    if (value) return value as NonNullable<T>
    const error = document.querySelector('[role="alert"]')?.textContent
    if (error) throw Error(message + ': ' + error)
    if (performance.now() > deadline) throw Error('Timeout: ' + message)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
/** @param text Exact visible button text. @param scope Current page/dialog. @returns An enabled visible button. */
function button(text: string, scope: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text && !b.disabled && b.getClientRects().length > 0
  )
}
/** @param text Exact button text. @returns Resolves after clicking the actual UI control. */
async function click(text: string) {
  ;(await waitFor(() => button(text), text)).click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}
/** @param field Actual controlled React input. @param value New text. @returns No value; emits a normal bubbling input event. */
function input(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
/** @param operation Public operation label. @param task Real UI operation and assertions. @returns Resolves after recording end-to-end and native elapsed times. */
async function timed(operation: string, task: () => Promise<void>) {
  window.__publicIoStage = operation
  calls = []
  let blocking = 0,
    progress = 0,
    redundantCancel = 0
  const importing = operation.includes('import-')
  const observer = new MutationObserver(() => {
    if (!importing) return
    blocking += document.querySelectorAll('[role="dialog"][aria-label="正在导入表格"]').length
    redundantCancel = Math.max(
      redundantCancel,
      Array.from(document.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === '取消导入'
      ).length
    )
    progress = Math.max(progress, document.querySelectorAll('[role="progressbar"]').length)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  const start = performance.now()
  try {
    await task()
    check(!blocking, 'Import must not flash a blocking validation dialog')
    check(progress <= 1, 'Import must not duplicate progress')
    check(redundantCancel === 0, 'Import must not add the removed trailing cancel button')
    results.push({ operation, totalMs: performance.now() - start, nativeCalls: [...calls] })
  } finally {
    observer.disconnect()
  }
}

/** @param label Measured operation. @param action Actual enabled UI action. @param count Expected published files. @returns Newly published, native readback-proven files. */
async function saved(label: string, action: () => Promise<void>, count = 1) {
  const before = published.length
  await timed(label, async () => {
    await action()
    await waitFor(() => published.length === before + count, 'published ' + label)
    await waitFor(
      () =>
        !document.querySelector('.operation-feedback .busy-progress') &&
        !document.querySelector('[role="dialog"][aria-label="导出日志"]'),
      'finished ' + label
    )
  })
  const files = published.slice(before)
  check(
    files.every((file) => file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256)),
    'Every output needs complete byte/hash proof'
  )
  return files
}

/** @param label One supported export format label. @returns Resolves after selecting the real dropdown option and clicking save. */
async function chooseExport(label: string) {
  const dialog = await waitFor(
    () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="导出日志"]'),
    'export dialog'
  )
  dialog.querySelector<HTMLButtonElement>('[role="combobox"]')!.click()
  const option = await waitFor(
    () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
        (item) => item.textContent?.replace('✓', '').trim() === label
      ),
    'format ' + label
  )
  option.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await click('保存导出文件')
}

/** @returns Completes all supported table, backup and six-format single/batch/combined exports through the packaged UI. */
async function completeMatrix() {
  confirmations = setInterval(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="确认操作"]')
    if (dialog) button('确认', dialog)?.click()
  }, 20)
  await click('数据与设置')
  for (const extension of ['csv', 'xlsx', 'xls']) {
    window.__publicIoSource = 'public-io-table.' + extension
    await timed('record-table-import-preview-' + extension, async () => {
      await click('导入场次表格')
      await waitFor(
        () => document.querySelector('[role="dialog"][aria-label="表格导入预览"]'),
        'table preview ' + extension
      )
    })
    await timed('record-table-import-commit-' + extension, async () => {
      await click(button('确认添加或更新表格数据') ? '确认添加或更新表格数据' : '确认添加表格数据')
      await waitFor(
        () => !document.querySelector('[role="dialog"][aria-label="表格导入预览"]'),
        'table commit ' + extension
      )
      await waitFor(() => button('导入场次表格'), 'table commit unlocked')
    })
    const state = await Native.getOverview(),
      metadata = JSON.parse(state.json!)
    check(metadata.records.length === 193, 'All 114 links and complete manual record must survive')
    const manual = metadata.records.find((row: { name: string }) => row.name === '公开导入完整手动正文')
    const content = JSON.parse(
      (await Native.getRecordContent({ ids: [manual.id], expectedRevision: state.revision })).json
    )
    check(
      content.records[0].manualContent === 'PUBLIC_MANUAL_BEGIN\n完整😀正文\nPUBLIC_MANUAL_END',
      'Manual Unicode/newlines must be complete'
    )
  }
  for (const [label, operation] of [
    ['导出记录 CSV', 'record-table-export-csv'],
    ['导出记录 Excel', 'record-table-export-xlsx'],
    ['保存空白模板 CSV', 'blank-template-csv'],
    ['保存空白模板 Excel', 'blank-template-xlsx']
  ])
    await saved(operation!, () => click(label!))
  const backups: SavedDocument[] = []
  backups.push(
    ...(await saved('backup-export-json', () =>
      click(Capacitor.getPlatform() === 'ios' ? '保存手机备份' : '保存安卓备份')
    ))
  )
  backups.push(...(await saved('backup-export-zip-with-attachments', () => click('保存含归档 ZIP 备份'))))
  check(
    /^[0-9]{8}COC跑团记录簿\.json$/.test(backups[0]!.name),
    'First backup uses date and app name without sequence'
  )
  check(
    backups[1]!.name === backups[0]!.name.replace(/\.json$/, '1.zip'),
    'JSON and ZIP share daily sequence from one'
  )
  for (const backup of backups) {
    window.__publicIoSource = backup.name
    const extension = backup.name.endsWith('.zip') ? 'zip' : 'json'
    await timed('backup-import-preview-' + extension, async () => {
      await click('选择备份并预览')
      await waitFor(
        () => document.querySelector('[role="dialog"][aria-labelledby="restore-title"]'),
        'backup preview'
      )
    })
    await timed('backup-import-commit-' + extension, async () => {
      await click('确认覆盖并导入')
      await waitFor(() => button('批量检测'), 'backup restore completed')
    })
    const state = await Native.getOverview()
    check(JSON.parse(state.json!).records.length === 193, 'Restored complete metadata')
    const rows = JSON.parse(
      (
        await Native.getRecordContent({
          ids: ['public-io-0', 'public-io-77'],
          expectedRevision: state.revision
        })
      ).json
    ).records
    check(
      rows.every(
        (row: { rawContent: { messages: Array<{ text: string }> } }) =>
          row.rawContent.messages.length === 650 && row.rawContent.messages[649]!.text.includes('PUBLIC_END_')
      ),
      'Restored complete first and last raw bodies'
    )
    await click('数据与设置')
  }
  const automatic = await saved('automatic-backup-json', () => click('立即生成自动备份'))
  check(
    automatic[0]!.name === backups[0]!.name.replace(/\.json$/, '2.json'),
    'Automatic backup continues the daily sequence'
  )
  await click('跑团记录')
  const moduleToggle = await waitFor(
    () => document.querySelector<HTMLButtonElement>('[data-module-toggle][aria-label="模组 公开计时模组"]'),
    'original public module'
  )
  if (moduleToggle.getAttribute('aria-expanded') !== 'true') {
    moduleToggle.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const first = await waitFor(
    () => document.querySelector<HTMLButtonElement>('[data-record-id="public-io-0"]'),
    'public record'
  )
  first.click()
  await waitFor(() => button('更多导出格式'), 'reader ready')
  for (const label of ['原始 JSON', 'TXT', '带图 DOC', '纯对话 DOC', 'DOCX', 'PDF']) {
    await saved('single-export-' + label, async () => {
      await click('更多导出格式')
      await chooseExport(label)
    })
  }
  await click('返回场次')
  await click('全选此模组')
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('.selection-check input'))
  check(boxes.length === 78, 'Select only the public raw module')
  for (const box of boxes.slice(2)) {
    box.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  for (const combined of [false, true])
    for (const label of ['原始 JSON', 'TXT', '带图 DOC', '纯对话 DOC', 'DOCX', 'PDF']) {
      await saved(
        (combined ? 'combined' : 'batch') + '-export-' + label,
        async () => {
          await click(combined ? '合成导出' : '批量导出')
          check(
            document
              .querySelector('[role="dialog"][aria-label="导出日志"]')
              ?.textContent?.includes('已选择 2 个场次'),
            'Exactly two complete records'
          )
          await chooseExport(label)
        },
        combined ? 1 : 2
      )
    }
}

void (async () => {
  try {
    const overview = await Native.getOverview(),
      library = JSON.parse(overview.json!)
    check(
      library.records.length === 78 &&
        library.records.every((r: { id: string }) => /^public-io-\d+$/.test(r.id)),
      'Refuse non-public library'
    )
    await waitFor(() => document.querySelector<HTMLInputElement>('.module-body-search input'), 'module input')
    const queries = ['PUBLIC_IO_NEEDLE', 'PUBLIC_END_', '公开完整正文']
    for (
      let repeat = 0;
      ['baseline', 'complete'].includes(window.__publicIoConfig.mode) && repeat < 3;
      repeat++
    ) {
      await timed('module-search-' + repeat, async () => {
        const field = document.querySelector<HTMLInputElement>('.module-body-search input')!
        input(field, queries[repeat]!)
        await new Promise((resolve) => setTimeout(resolve, 0))
        const submit = await waitFor(
          () => document.querySelector<HTMLButtonElement>('button[aria-label="搜索模组正文"]'),
          'search submit'
        )
        submit.click()
        await waitFor(
          () =>
            document
              .querySelector('.module-body-search [role="status"]')
              ?.textContent?.includes('匹配 78 个场次'),
          'complete 78-record search'
        )
        check(
          document
            .querySelector('.search-result')
            ?.textContent?.includes((repeat === 2 ? 7800 : 650) + ' 处'),
          'Search count must preserve complete messages'
        )
      })
      document.querySelector<HTMLButtonElement>('button[aria-label="清空模组正文搜索"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await click('角色卡')
    if (window.__publicIoConfig.mode === 'complete') {
      window.__publicIoSource = 'public-io-card.xlsx'
      delayNextStageForCancellation = true
      await timed('character-import-back-cancel-with-delayed-stage', async () => {
        await click('导入七版角色卡')
        await waitFor(
          () =>
            !delayNextStageForCancellation &&
            document.querySelector('[role="progressbar"][aria-label="导入处理进度"]'),
          'real card progress before back'
        )
        document.querySelector<HTMLButtonElement>('.app-back')!.click()
        await waitFor(
          () => button('导入七版角色卡') && !document.querySelector('.editor'),
          'back cancellation finished'
        )
        check(
          (await Native.getOverview()).revision === overview.revision,
          'Back-cancelled card must not write'
        )
      })
      await delayedCancellationStage
      delayNextStageForCancellation = false
    }
    for (const extension of window.__publicIoConfig.mode === 'matrix' ? [] : ['xlsx', 'xls'])
      for (let repeat = 0; repeat < 3; repeat++) {
        window.__publicIoSource = 'public-io-card.' + extension
        if (extension === 'xls') {
          await timed('character-import-xls-explicit-rejection-' + repeat, async () => {
            await click('导入七版角色卡')
            await waitFor(
              () =>
                document
                  .querySelector('[role="alert"]')
                  ?.textContent?.includes('请选择七版角色卡的 XLSX 文件'),
              'unsupported card explicitly rejected'
            )
          })
          check(
            (await Native.getOverview()).revision === overview.revision,
            'Unsupported card must not write'
          )
          continue
        }
        await timed('character-import-' + extension + '-' + repeat, async () => {
          await click('导入七版角色卡')
          await waitFor(
            () =>
              document.querySelector<HTMLInputElement>('.editor input[role="combobox"]')?.value ===
              '公开七版调查员',
            'complete character draft'
          )
        })
        await click('取消编辑')
        if (button('确认')) await click('确认')
        await waitFor(() => button('导入七版角色卡'), 'character cancellation')
        check((await Native.getOverview()).revision === overview.revision, 'Cancelled card must not write')
      }
    if (['complete', 'matrix'].includes(window.__publicIoConfig.mode)) await completeMatrix()
    window.__publicIoResult = {
      passed: true,
      results,
      documents: published,
      source:
        'fictional public fixtures; actual WebView, Worker, SQLite and bounded native file copy; OS picker response is deterministic',
      physicalPhone: undefined
    }
  } catch (error) {
    window.__publicIoResult = { passed: false, stage: window.__publicIoStage, error: String(error), results }
  } finally {
    cap.nativePromise = nativePromise
    clearInterval(confirmations)
  }
})()
