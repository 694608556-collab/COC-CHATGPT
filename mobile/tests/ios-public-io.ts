import { Native } from '../src/data/native'
import inputs from '../ios/build/public-io/inputs.json'

// Injected into a second fresh DEBUG simulator only; never included in IPA assets.
window.__cocSmokeTask = (async () => {
  // Public fixture diagnostics only: retain PNG header fields, never page pixels.
  const pngHeaders: Array<Record<string, number | string>> = []
  // Observe the existing completed read; do not delay/replace canvas callbacks.
  const read = FileReader.prototype.readAsArrayBuffer
  FileReader.prototype.readAsArrayBuffer = function (this: FileReader, blob: Blob) {
    if (blob.type === 'image/png' && !pngHeaders.length)
      this.addEventListener(
        'load',
        () => {
          try {
            if (!(this.result instanceof ArrayBuffer)) throw Error('Public PNG metadata unavailable')
            const view = new DataView(this.result)
            pngHeaders.push({
              width: view.getUint32(16),
              height: view.getUint32(20),
              bitDepth: view.getUint8(24),
              colorType: view.getUint8(25),
              compression: view.getUint8(26),
              filter: view.getUint8(27),
              interlace: view.getUint8(28)
            })
          } catch (error) {
            pngHeaders.push({ error: String(error) })
          }
        },
        { once: true }
      )
    return read.call(this, blob)
  }
  window.__cocSmokeStage = 'public-io-setup'
  const state = await Native.getOverview()
  const rows = JSON.parse(state.json!).records
  if (rows.length !== 78 || !rows.every((row: { id: string }) => /^public-io-\d+$/.test(row.id)))
    throw Error('Refuse any non-public iOS database')
  await Native.selectArchive({ localFolder: true })
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('focus'))
  window.__publicIoDocuments = {}
  for (const [name, base64] of Object.entries(inputs)) {
    window.__publicIoDocuments[name] = await Native.writeArchive({
      name,
      base64,
      mime: 'application/octet-stream',
      purpose: 'export'
    })
  }
  window.__publicIoConfig = { mode: 'complete' }
  await import('./public-io-webview')
  const deadline = performance.now() + 850000
  while (!window.__publicIoResult) {
    window.__cocSmokeStage = window.__publicIoStage ?? 'public-io-ready'
    if (performance.now() > deadline) throw Error('Complete public iOS I/O timeout')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return {
    ...(window.__publicIoResult as object),
    pngHeaders,
    physicalPhone: false,
    environment:
      'fresh iOS simulator; real WKWebView, Workers, SQLite and registered local files; deterministic picker response'
  }
})().catch((error) => ({ passed: false, stage: window.__cocSmokeStage, error: String(error) }))
window.__cocSmokeTask.then((result) => {
  window.__cocSmokeResult = result
})
