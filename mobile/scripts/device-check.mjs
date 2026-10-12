import { writeFile } from 'node:fs/promises'
import { transform } from 'esbuild'

const targets = await (await fetch('http://127.0.0.1:9229/json/list')).json()
const target = targets.find((item) => item.url.startsWith('https://localhost'))
if (!target) throw new Error('Owned development WebView not found')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const mode = process.argv[2] || 'state'
const expression =
  mode === 'guards'
    ? `(async () => {
  const api = window.Capacitor.Plugins.Logbook;
  const before = await api.getState();
  const data = JSON.stringify({schemaVersion:2,exportedAt:'2026-10-13T00:00:00.000Z',modules:[],records:[],characters:[],settings:{theme:'light',filterPreset:{}}});
  let confirmationRejected=false, staleRevisionRejected=false, missingSafetyLocationRejected=null;
  try { await api.commitRestore({json:data,expectedRevision:before.revision,confirmed:false}); } catch(error) { confirmationRejected=true; }
  try { await api.commitRestore({json:data,expectedRevision:before.revision+1,confirmed:true}); } catch(error) { staleRevisionRejected=true; }
  if (before.json===null && !before.archive.uri && before.revision===0) {
    try { await api.commitRestore({json:data,expectedRevision:0,confirmed:true}); } catch(error) { missingSafetyLocationRejected=true; }
  }
  const after=await api.getState();
  return {confirmationRejected,staleRevisionRejected,missingSafetyLocationRejected,dataUnchanged:before.json===after.json && before.revision===after.revision};
})()`
    : `(async () => {
  const state=await window.Capacitor.Plugins.Logbook.getState();
  const data=state.json ? JSON.parse(state.json) : null;
  return {networkConnected:state.networkConnected,revision:state.revision,archive:state.archive,hasData:!!data,modules:data?.modules.length||0,records:data?.records.length||0,characters:data?.characters.length||0,messages:data?.records.reduce((sum,r)=>sum+(r.rawContent?.messages.length||0),0)||0,viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,gateVisible:!!document.querySelector('.onboarding'),readerVisible:!!document.querySelector('.messages'),errorVisible:!!document.querySelector('.error')};
})()`
const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Device check timeout')), 30000)
  socket.addEventListener('message', (event) => {
    const reply = JSON.parse(event.data)
    if (reply.id === 1) {
      clearTimeout(timeout)
      resolve(reply)
    }
  })
  transform(expression, { target: 'chrome69' })
    .then((output) =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression: output.code, awaitPromise: true, returnByValue: true }
        })
      )
    )
    .catch(reject)
})
socket.close()
if (result.result?.exceptionDetails) throw new Error('Owned WebView validation failed')
const report = result.result?.result?.value
if (!report) throw new Error('Device report unavailable')
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (
  mode === 'guards' &&
  (!report.confirmationRejected ||
    !report.staleRevisionRejected ||
    !report.dataUnchanged ||
    report.missingSafetyLocationRejected === false)
)
  process.exitCode = 2
