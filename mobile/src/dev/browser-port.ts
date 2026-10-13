import type { LogbookPort, NativeState, SavedDocument } from '../data/native'
import { decodeBase64, encodeBase64 } from '../data/native'
import { encodeBackup, previewBackup } from '../data/backup'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'

export interface BrowserDocument extends SavedDocument {
  base64: string
  mime: string
}
const initial: NativeState = {
  networkConnected: false,
  json: null,
  revision: 0,
  archive: { uri: '', label: '尚未选择', valid: false }
}

/** Development-only system boundary. Never imported by the APK entry point. */
export function createBrowserPort(name = 'coc-logbook-browser-dev-v1') {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('state')
      request.result.createObjectStore('documents', { keyPath: 'uri' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  async function readState(): Promise<NativeState> {
    const db = await database
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state')
      const request = tx.objectStore('state').get('current')
      request.onsuccess = () => resolve(request.result ?? initial)
      request.onerror = () => reject(request.error)
    })
  }
  async function document(name: string, mime: string, bytes: Uint8Array): Promise<BrowserDocument> {
    if (
      !name ||
      name.length > 120 ||
      /[/\\]/.test(name) ||
      Array.from(name).some((c) => c.charCodeAt(0) < 32) ||
      name.includes('..')
    )
      throw new Error('文件名不合法。')
    if (bytes.length > 64 * 1024 * 1024) throw new Error('文件超过 64 MB。')
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))
    return {
      uri: 'browser-test:' + crypto.randomUUID(),
      name,
      mime,
      bytes: bytes.length,
      sha256: Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join(''),
      base64: encodeBase64(bytes)
    }
  }
  async function commit(json: string, expectedRevision: number, prefix: string) {
    const next = (await previewBackup(new TextEncoder().encode(json))).snapshot
    const before = await readState()
    if (!before.archive.valid) throw new Error('请先启用浏览器测试存储。')
    if (before.revision !== expectedRevision) throw new Error('数据已变化，请重新打开编辑或导入预览。')
    const snapshot = before.json
      ? (await previewBackup(new TextEncoder().encode(before.json))).snapshot
      : {
          schemaVersion: 2 as const,
          exportedAt: new Date().toISOString(),
          modules: [],
          records: [],
          characters: [],
          settings: {
            theme: 'light' as const,
            filterPreset: DEFAULT_FILTER_PRESET
          }
        }
    const safety = await document(
      prefix + '-' + Date.now() + '.json',
      'application/json',
      encodeBackup(snapshot)
    )
    const db = await database
    return new Promise<{ revision: number; safetyBackup: SavedDocument }>((resolve, reject) => {
      const tx = db.transaction(['state', 'documents'], 'readwrite')
      const states = tx.objectStore('state')
      let failure: Error | undefined
      const request = states.get('current')
      request.onsuccess = () => {
        const current: NativeState = request.result ?? initial
        if (current.revision !== expectedRevision || !current.archive.valid) {
          failure = new Error('数据或测试存储已变化，请重新打开编辑或导入预览。')
          tx.abort()
          return
        }
        const documents = tx.objectStore('documents')
        documents.add(safety)
        const check = documents.get(safety.uri)
        check.onsuccess = () => {
          if (check.result?.base64 !== safety.base64) {
            failure = new Error('测试安全副本回读失败。')
            tx.abort()
            return
          }
          states.put(
            {
              ...current,
              json: JSON.stringify(next),
              revision: expectedRevision + 1
            },
            'current'
          )
        }
      }
      tx.oncomplete = () => resolve({ revision: expectedRevision + 1, safetyBackup: safety })
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('测试存储写入失败。'))
      tx.onerror = () => reject(tx.error)
    })
  }
  const port: LogbookPort = {
    getState: readState,
    async selectArchive() {
      if (!window.confirm('启用浏览器测试存储？数据只保存在当前浏览器中，不代表安卓目录授权。'))
        return { cancelled: true }
      const db = await database
      const archive = {
        uri: 'browser-test:archive',
        label: '浏览器测试存储（非安卓目录）',
        valid: true
      }
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite')
        const store = tx.objectStore('state')
        const request = store.get('current')
        request.onsuccess = () => store.put({ ...(request.result ?? initial), archive }, 'current')
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error)
        tx.onerror = () => reject(tx.error)
      })
      return { cancelled: false, archive }
    },
    openBackup: () =>
      new Promise((resolve, reject) => {
        const input = window.document.createElement('input')
        input.type = 'file'
        input.accept = '.json,.zip'
        input.hidden = true
        window.document.body.append(input)
        input.oncancel = () => {
          input.remove()
          resolve({ cancelled: true })
        }
        input.onchange = async () => {
          try {
            const file = input.files?.[0]
            if (!file) {
              resolve({ cancelled: true })
              return
            }
            if (file.size > 64 * 1024 * 1024) throw new Error('备份超过 64 MB。')
            resolve({
              cancelled: false,
              name: file.name,
              base64: encodeBase64(new Uint8Array(await file.arrayBuffer()))
            })
          } catch (error) {
            reject(error)
          } finally {
            input.remove()
          }
        }
        input.click()
      }),
    async writeArchive({ name, mime, base64 }) {
      const file = await document(name, mime, decodeBase64(base64))
      const db = await database
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['state', 'documents'], 'readwrite')
        let failure: Error | undefined
        const state = tx.objectStore('state').get('current')
        state.onsuccess = () => {
          if (!state.result?.archive.valid) {
            failure = new Error('请先启用浏览器测试存储。')
            tx.abort()
            return
          }
          const documents = tx.objectStore('documents')
          documents.add(file)
          const back = documents.get(file.uri)
          back.onsuccess = () => {
            if (back.result?.base64 !== file.base64) {
              failure = new Error('测试文件回读失败。')
              tx.abort()
            }
          }
        }
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(failure ?? tx.error)
        tx.onerror = () => reject(tx.error)
      })
      return file
    },
    async commitRestore({ json, expectedRevision, confirmed }) {
      if (!confirmed) throw new Error('需要明确确认覆盖。')
      return commit(json, expectedRevision, 'before-restore')
    },
    async commitEdit({ json, expectedRevision }) {
      return commit(json, expectedRevision, 'before-edit')
    }
  }
  return {
    port,
    async documents(): Promise<BrowserDocument[]> {
      const db = await database
      return new Promise((resolve, reject) => {
        const request = db.transaction('documents').objectStore('documents').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    },
    async close() {
      ;(await database).close()
    }
  }
}
