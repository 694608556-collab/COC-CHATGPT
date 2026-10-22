import { test, expect } from '@playwright/test'
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { exampleBackup } from '../src/data/fixtures'

test('实际打包Worker逐段等待原生确认，预览不自动覆盖，暂存失败取消本租约', async ({ page }) => {
  const backup = exampleBackup()
  backup.records[0]!.rawContent!.messages[0]!.text = '公开😀\r\n\0' + 'A'.repeat(2 * 1024 * 1024)
  const bytes = Buffer.from(JSON.stringify(backup)), hash = createHash('sha256').update(bytes).digest('hex')
  await page.route('**/_capacitor_file_/public-backup.json', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'content-length': String(bytes.length) }, body: bytes
  }))
  const code = await build({
    stdin: { resolveDir: resolve('.'), loader: 'ts', contents: `
      import {previewNativeBackup} from './src/data/backup-stream-client';
      window.publicPreview = previewNativeBackup;` },
    bundle: true, write: false, format: 'iife', target: 'chrome69'
  })
  await page.goto('/')
  await page.addScriptTag({ content: code.outputFiles[0]!.text })
  const results = await page.evaluate(async ({bytes, hash}) => {
    const run = async (fail: boolean) => {
      let active = 0, maximum = 0, chunks = 0, confirmed = 0, cancelled = '', validated = false
      const indexes = new Map<string, number>()
      const port = {
        appendBackupStage: async (part: { id: string; key: string; index: number; base64: string }) => {
          active++; maximum = Math.max(maximum, active)
          try {
            if (part.id !== 'public-lease' || atob(part.base64).length > 262144 || part.index !== (indexes.get(part.key) ?? 0)) throw Error('Invalid chunk')
            await new Promise(resolve => setTimeout(resolve, 1))
            if (fail && chunks === 2) throw Error('public storage failure')
            indexes.set(part.key, part.index + 1); chunks++
          } finally { active-- }
        },
        finishBackupPreview: async (value: {candidate: {bytes: number}}) => { validated = value.candidate.bytes > bytes; return {id:'public-lease', revision:7, offlineRecords:1} },
        commitBackupRestore: async () => { confirmed++ },
        cancelBackupStage: async ({id}: {id:string}) => {cancelled=id},
        createBackupStream: async () => {throw Error('Unexpected export')},
        finishBackupExport: async () => {throw Error('Unexpected export')}
      }
      let preview: any, error = ''
      try {
        preview = await (window as any).publicPreview(port, {id:'public-lease',revision:7,format:'json',maximumStageBytes:16*1024*1024,
          bytes,sha256:hash,fileUri:location.origin+'/_capacitor_file_/public-backup.json'})
      } catch (failure) {error=String(failure)}
      return {maximum,chunks,confirmed,cancelled,validated,error,lease:preview?.lease,
        hasBody:preview?.snapshot.records.some((row:any)=>'rawContent' in row || 'manualContent' in row)}
    }
    return [await run(false), await run(true)]
  }, { bytes: bytes.length, hash })
  expect(results[0]).toMatchObject({ maximum: 1, confirmed: 0, cancelled: '', validated: true, lease: 'public-lease', hasBody: false, error: '' })
  expect(results[0]!.chunks).toBeGreaterThan(8)
  expect(results[1]).toMatchObject({ maximum: 1, confirmed: 0, cancelled: 'public-lease', validated: false })
  expect(results[1]!.error).toContain('public storage failure')
})
