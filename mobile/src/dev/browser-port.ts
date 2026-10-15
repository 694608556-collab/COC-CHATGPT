import type { LogbookPort, NativeState, SavedDocument } from '../data/native'
import { decodeBase64, encodeBase64 } from '../data/native'
import { encodeBackup, previewBackup } from '../data/backup'
import { DEFAULT_FILTER_PRESET } from '../../../src/shared/types'
import { applyAction } from '../data/actions'
import { encodeInBackground } from '../data/background'
import { validateSettings } from '../data/settings'
import { applyEdit } from '../data/edit'

export interface BrowserDocument extends SavedDocument {
  kind?: 'auto'
  createdAt?: number
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
  /**
   * 浏览器开发存储的确认后事务，不额外创建操作前副本，不进入 APK。
   * @param json - 已完成界面确认的候选快照。
   * @param expectedRevision - 调用时持久化版本。
   * @param attachments - 与恢复事务一并登记的归档附件。
   * @returns 新版本；校验、附件或版本失败不提交数据。
   */
  async function commit(
    json: string,
    expectedRevision: number,
    attachments: Array<{ name: string; mime: string; base64: string }> = []
  ) {
    const next = (await previewBackup(new TextEncoder().encode(json))).snapshot
    const before = await readState()
    if (!before.archive.valid) throw new Error('请先启用浏览器测试存储。')
    if (before.revision !== expectedRevision) throw new Error('数据已变化，请重新打开编辑或导入预览。')
    const imported = await Promise.all(
      attachments.map(async (file) => ({
        ...(await document(file.name, file.mime, decodeBase64(file.base64))),
        purpose: 'import' as const
      }))
    )
    const db = await database
    return new Promise<{ revision: number; safetyBackup?: SavedDocument }>((resolve, reject) => {
      const tx = db.transaction(['state', 'documents'], 'readwrite')
      const states = tx.objectStore('state')
      let failure: Error | undefined
      const request = states.get('current')
      request.onsuccess = () => {
        const current: NativeState = request.result ?? initial
        if (
          current.revision !== expectedRevision ||
          !current.archive.valid ||
          current.archive.uri !== before.archive.uri
        ) {
          failure = new Error('数据或测试存储已变化，请重新打开编辑或导入预览。')
          tx.abort()
          return
        }
        const documents = tx.objectStore('documents')
        imported.forEach((file) => documents.add(file))
        /** @returns 无返回值；窗口标记与业务数据在同一成功事务内更新。 */
        const replace = () => {
          states.put(
            {
              ...current,
              json: JSON.stringify(next),
              revision: expectedRevision + 1
            },
            'current'
          )
        }
        replace()
      }
      tx.oncomplete = () => resolve({ revision: expectedRevision + 1 })
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('测试存储写入失败。'))
      tx.onerror = () => reject(tx.error)
    })
  }
  const port: LogbookPort = {
    async getStatus() {
      const state = await readState()
      return {
        revision: state.revision,
        archive: state.archive,
        lastAutoBackupAt: state.lastAutoBackupAt,
        lastAutoBackupRevision: state.lastAutoBackupRevision
      }
    },
    async commitEntity({ edit, expectedRevision }) {
      if (
        !['record', 'character'].includes(edit.kind) ||
        (edit.kind === 'record' && edit.value.rawContent !== undefined)
      )
        throw new Error('实体请求不合法。')
      const before = await readState()
      if (!before.archive.valid || before.revision !== expectedRevision)
        throw new Error('数据或测试存储已变化，请重新读取。')
      const next = await applyEdit(
        before.json
          ? JSON.parse(before.json)
          : {
              schemaVersion: 2,
              exportedAt: new Date().toISOString(),
              modules: [],
              records: [],
              characters: [],
              settings: { theme: 'light', filterPreset: DEFAULT_FILTER_PRESET }
            },
        edit
      )
      const db = await database
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite'),
          states = tx.objectStore('state')
        let failure: Error | undefined
        const request = states.get('current')
        request.onsuccess = () => {
          const latest: NativeState = request.result ?? initial
          if (
            !latest.archive.valid ||
            latest.archive.uri !== before.archive.uri ||
            latest.revision !== expectedRevision
          ) {
            failure = new Error('数据或测试存储已变化，请重新读取。')
            tx.abort()
            return
          }
          states.put({ ...latest, json: JSON.stringify(next), revision: expectedRevision + 1 }, 'current')
        }
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('编辑未保存。'))
        tx.onerror = () => reject(tx.error)
      })
      return { revision: expectedRevision + 1, exportedAt: next.exportedAt }
    },
    /** @param options - 模组草稿与当前版本。 @returns 提交后的版本/时间；不生成副本或改动正文。 */
    async commitModule({ value, expectedRevision }) {
      const state = await readState()
      if (state.revision !== expectedRevision || !state.archive.valid)
        throw new Error('数据或测试存储已变化，请重新读取。')
      const current = state.json
        ? JSON.parse(state.json)
        : {
            schemaVersion: 2,
            modules: [],
            records: [],
            characters: [],
            settings: { theme: 'light', filterPreset: DEFAULT_FILTER_PRESET },
            exportedAt: new Date().toISOString()
          }
      const next = await applyEdit(current, { kind: 'module', value })
      const db = await database
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite'),
          store = tx.objectStore('state')
        let failure: Error | undefined
        const request = store.get('current')
        request.onsuccess = () => {
          const latest = request.result ?? initial
          if (
            latest.revision !== expectedRevision ||
            !latest.archive.valid ||
            latest.archive.uri !== state.archive.uri
          ) {
            failure = new Error('数据或测试存储已变化，请重新读取。')
            tx.abort()
            return
          }
          store.put({ ...latest, json: JSON.stringify(next), revision: expectedRevision + 1 }, 'current')
        }
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('模组保存失败。'))
        tx.onerror = () => reject(tx.error)
      })
      return { revision: expectedRevision + 1, exportedAt: next.exportedAt }
    },
    async listDocuments(options) {
      const db = await database
      const files = await new Promise<BrowserDocument[]>((resolve, reject) => {
        const request = db.transaction('documents').objectStore('documents').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return {
        documents: files
          .slice(options?.all ? 0 : -30)
          .reverse()
          .map((file) => ({
            uri: file.uri,
            name: file.name,
            bytes: file.bytes,
            sha256: file.sha256,
            purpose: file.purpose
          }))
      }
    },
    async readDocument({ uri }) {
      const db = await database
      return new Promise((resolve, reject) => {
        const request = db.transaction('documents').objectStore('documents').get(uri)
        request.onsuccess = () =>
          request.result
            ? resolve({ name: request.result.name, mime: request.result.mime, base64: request.result.base64 })
            : reject(new Error('归档文件不存在。'))
        request.onerror = () => reject(request.error)
      })
    },
    async fetchLog({ url }) {
      const endpoint = new URL(url)
      if (endpoint.origin !== 'https://dice-api.weizaima.com' || endpoint.pathname !== '/dice/api/load_data')
        throw new Error('不支持此日志地址。')
      const response = await fetch('/_logbook/sea?url=' + encodeURIComponent(url))
      if (!response.ok) throw new Error('日志连接失败。')
      return response.json()
    },
    async automaticBackup({ json, expectedRevision }) {
      const before = await readState()
      const source = before.json
      if (json !== undefined && json !== source) throw new Error('数据已变化，本次自动备份未执行。')
      if (!source || !before.archive.valid || before.revision !== expectedRevision)
        throw new Error('数据已变化，本次自动备份未执行。')
      const snapshot = (await previewBackup(new TextEncoder().encode(source))).snapshot
      const startedAt = Date.now()
      const file = {
        ...(await document('auto-backup-' + startedAt + '.json', 'application/json', encodeBackup(snapshot))),
        kind: 'auto' as const,
        purpose: 'auto' as const,
        createdAt: startedAt
      }
      const db = await database
      let savedAt = 0
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['state', 'documents'], 'readwrite')
        let failure: Error | undefined
        const states = tx.objectStore('state')
        const documents = tx.objectStore('documents')
        const current = states.get('current')
        current.onsuccess = () => {
          if (!current.result?.archive.valid || current.result.archive.uri !== before.archive.uri) {
            failure = new Error('数据或目录已变化，本次自动备份未执行。')
            tx.abort()
            return
          }
          documents.add(file)
          const back = documents.get(file.uri)
          back.onsuccess = () => {
            if (back.result?.base64 !== file.base64) {
              failure = new Error('自动备份回读失败。')
              tx.abort()
              return
            }
            savedAt = Date.now()
            states.put(
              { ...current.result, lastAutoBackupAt: savedAt, lastAutoBackupRevision: expectedRevision },
              'current'
            )
            const all = documents.getAll()
            all.onsuccess = () => {
              const owned: BrowserDocument[] = all.result.filter((f: BrowserDocument) => f.kind === 'auto')
              owned.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
              owned.slice(10).forEach((f) => documents.delete(f.uri))
            }
          }
        }
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(failure ?? tx.error)
        tx.onerror = () => reject(tx.error)
      })
      return { document: file, savedAt, revision: expectedRevision }
    },
    async openDocument({ uri }) {
      const db = await database
      const file = await new Promise<BrowserDocument>((resolve, reject) => {
        const request = db.transaction('documents').objectStore('documents').get(uri)
        request.onsuccess = () =>
          request.result ? resolve(request.result) : reject(new Error('测试文件已不存在。'))
        request.onerror = () => reject(request.error)
      })
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(decodeBase64(file.base64)).buffer], { type: file.mime })
      )
      const opened = window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      if (!opened) {
        const a = window.document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
      }
    },
    async shareDocument({ uri }) {
      const db = await database
      const file = await new Promise<BrowserDocument>((resolve, reject) => {
        const request = db.transaction('documents').objectStore('documents').get(uri)
        request.onsuccess = () =>
          request.result ? resolve(request.result) : reject(new Error('测试文件已不存在。'))
        request.onerror = () => reject(request.error)
      })
      const blob = new File([new Uint8Array(decodeBase64(file.base64)).buffer], file.name, {
        type: file.mime
      })
      if (navigator.canShare?.({ files: [blob] })) await navigator.share({ files: [blob], title: file.name })
      else {
        const url = URL.createObjectURL(blob)
        const a = window.document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    },
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
    openBackup: (options) =>
      new Promise((resolve, reject) => {
        const input = window.document.createElement('input')
        input.type = 'file'
        input.accept = options?.kind && options.kind !== 'backup' ? '.csv,.xls,.xlsx' : '.json,.zip'
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
              base64: await encodeInBackground(new Uint8Array(await file.arrayBuffer()))
            })
          } catch (error) {
            reject(error)
          } finally {
            input.remove()
          }
        }
        input.click()
      }),
    async writeArchive({ name, mime, base64, purpose }) {
      const file = {
        ...(await document(name, mime, decodeBase64(base64))),
        purpose: purpose ?? ('export' as const)
      }
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
    async commitRestore({ json, expectedRevision, confirmed, attachments }) {
      if (!confirmed) throw new Error('需要明确确认覆盖。')
      const result = await commit(json, expectedRevision, attachments)
      return { revision: result.revision }
    },
    async commitEdit({ json, expectedRevision }) {
      return commit(json, expectedRevision)
    },
    /** @param options - 白名单设置及版本。 @returns 事务确认的新版本/时间；不改正文、归档或保护窗口。 */
    async commitSettings(options) {
      const { settings: input, expectedRevision } = options
      const settings = validateSettings(input)
      const exportedAt = new Date().toISOString()
      const db = await database
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite')
        let failure: Error | undefined
        const states = tx.objectStore('state')
        const request = states.get('current')
        request.onsuccess = () => {
          try {
            const state: NativeState = request.result ?? initial
            if (state.revision !== expectedRevision || !state.archive.valid)
              throw new Error('数据或测试存储已变化，请重新读取。')
            const current = state.json
              ? JSON.parse(state.json)
              : {
                  schemaVersion: 2,
                  modules: [],
                  records: [],
                  characters: []
                }
            states.put(
              {
                ...state,
                json: JSON.stringify({ ...current, settings, exportedAt }),
                revision: expectedRevision + 1
              },
              'current'
            )
          } catch (reason) {
            failure = reason instanceof Error ? reason : new Error('设置未保存。')
            tx.abort()
          }
        }
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('设置未保存。'))
        tx.onerror = () => reject(tx.error)
      })
      return { revision: expectedRevision + 1, exportedAt }
    },
    /** 浏览器独立存储实现相同的安全/版本边界，不进入 APK。 */
    async commitAction({ action, expectedRevision }) {
      const before = await readState()
      if (before.revision !== expectedRevision) throw new Error('数据已变化，请重新操作。')
      if (!before.json) throw new Error('尚无已保存数据。')
      const current = JSON.parse(before.json)
      const next = await applyAction(current, action)
      if (action.type === 'reorder') {
        // 排序只更新顺序；同一事务重新核对版本与授权，不创建或删除安全副本。
        const json = JSON.stringify(next)
        const db = await database
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('state', 'readwrite')
          const states = tx.objectStore('state')
          let failure: Error | undefined
          const request = states.get('current')
          request.onsuccess = () => {
            const state: NativeState = request.result ?? initial
            if (state.revision !== expectedRevision || !state.archive.valid) {
              failure = new Error('数据或测试存储已变化，请重新操作。')
              tx.abort()
              return
            }
            states.put({ ...state, json, revision: expectedRevision + 1 }, 'current')
          }
          tx.oncomplete = () => resolve()
          tx.onabort = () => reject(failure ?? tx.error ?? new Error('排序未保存。'))
          tx.onerror = () => reject(tx.error)
        })
        return { revision: expectedRevision + 1, exportedAt: next.exportedAt }
      }
      const result = await commit(JSON.stringify(next), expectedRevision)
      return { ...result, exportedAt: next.exportedAt }
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
