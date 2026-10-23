import { Native } from '../src/data/native'
import inputs from '../ios/build/public-io/inputs.json'
import { iosPublicIoConfig } from './ios-public-io-config'

declare global {
  interface Window {
    __cocPublicTableFirst?: unknown
  }
}

// Injected into a second fresh DEBUG simulator only; never included in IPA assets.
window.__cocSmokeTask = (async () => {
  const config = iosPublicIoConfig(window.__cocPublicTableFirst)
  // Public fixture diagnostics only: retain PNG header fields, never page pixels.
  const pngHeaders: Array<Record<string, number | string>> = []
  // Read only the header before the normal Worker transfer detaches this buffer.
  // Forward the exact original arguments and transfer list; no extra pixel copy.
  const send = Worker.prototype.postMessage
  Worker.prototype.postMessage = function (message, options) {
    const png = message?.job?.type === 'pdf-png' ? message.job.png : undefined
    if (png instanceof Uint8Array && !pngHeaders.length) {
      try {
        const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
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
    }
    return Reflect.apply(send, this, arguments)
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
  window.__publicIoConfig = config
  await import('./public-io-webview')
  const deadline = performance.now() + 850000
  while (!window.__publicIoResult) {
    window.__cocSmokeStage = window.__publicIoStage ?? 'public-io-ready'
    if (performance.now() > deadline) throw Error('Complete public iOS I/O timeout')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return {
    ...(window.__publicIoResult as object),
    ...(config.mode === 'tables' ? { coldTableFirst: config.publicIoTableFirst } : {}),
    pngHeaders,
    physicalPhone: false,
    environment:
      'fresh iOS simulator; real WKWebView, Workers, SQLite and registered local files; deterministic picker response'
  }
})().catch((error) => ({ passed: false, stage: window.__cocSmokeStage, error: String(error) }))
window.__cocSmokeTask.then((result) => {
  window.__cocSmokeResult = result
})
