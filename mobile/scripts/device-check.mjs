import { writeFile } from 'node:fs/promises'
import { transform } from 'esbuild'

const debugUrl = new URL(process.env.COC_DEVICE_DEBUG_URL || 'http://127.0.0.1:9229')
if (
  debugUrl.protocol !== 'http:' ||
  debugUrl.hostname !== '127.0.0.1' ||
  debugUrl.username ||
  debugUrl.password
)
  throw new Error('Only a locally forwarded owned development WebView is supported')
const targets = await (await fetch(new URL('/json/list', debugUrl))).json()
const target = targets.find((item) => item.url.startsWith('https://localhost'))
if (!target) throw new Error('Owned development WebView not found')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const mode = process.argv[2] || 'state'
const expression =
  mode === 'content'
    ? `(async () => {
  const api = window.Capacitor.Plugins.Logbook, before = await api.getState();
  const data = before.json ? JSON.parse(before.json) : null;
  if (!data || data.records.length !== 70 || data.modules.length !== 1 || !data.modules[0].name.includes('公开手势性能测试') || document.querySelector('.editor,[role=dialog],[role=progressbar]'))
    throw new Error('This check requires the idle independent public gesture sample');
  if (!Number.isInteger(before.revision) || before.revision < 1 || before.revision > 2147483647)
    throw new Error('This regression specifically requires a small integer revision');
  const files = (await api.listDocuments({all:true})).documents;
  const overview = await api.getOverview(), deferred = overview.deferredRecordIds;
  if (deferred.length < 2) throw new Error('Two saved bodies are required');
  const ids = [deferred[0], deferred[deferred.length - 1]];
  const result = await api.getRecordContent({ids, expectedRevision:before.revision});
  const selected = JSON.parse(result.json).records;
  const complete = result.revision === before.revision && selected.length === 2 && ids.every(id => {
    const actual = selected.find(row => row.id === id), expected = data.records.find(row => row.id === id);
    return actual && expected && actual.moduleId === expected.moduleId && actual.sourceType === expected.sourceType &&
      JSON.stringify(actual.rawContent) === JSON.stringify(expected.rawContent) && actual.manualContent === expected.manualContent;
  });
  if (!complete) throw new Error('Selected complete body batch did not match committed data');
  let rejected = 0;
  for (const request of [
    {ids:[ids[0], 'public-missing-body-regression'], expectedRevision:before.revision},
    {ids:[ids[0], ids[0]], expectedRevision:before.revision},
    {ids, expectedRevision:before.revision - 1}
  ]) {
    let refused = false;
    try { await api.getRecordContent(request); } catch { refused = true; }
    if (!refused) throw new Error('Invalid body batch accepted');
    rejected++;
  }
  const after = await api.getState(), afterFiles = (await api.listDocuments({all:true})).documents;
  return {validContent:complete, revision:before.revision, smallIntegerRevision:true, records:selected.length,
    messages:selected.reduce((sum,row) => sum + (row.rawContent?.messages.length || 0), 0), rejected,
    dataUnchanged:before.json === after.json && before.revision === after.revision &&
      JSON.stringify(before.archive) === JSON.stringify(after.archive) && JSON.stringify(files) === JSON.stringify(afterFiles)};
})()`
    : mode === 'guards'
      ? `(async () => {
  const api = window.Capacitor.Plugins.Logbook;
  const before = await api.getState();
  const data = JSON.stringify({schemaVersion:2,exportedAt:'2026-10-13T00:00:00.000Z',modules:[],records:[],characters:[],settings:{theme:'light',filterPreset:{}}});
  let confirmationRejected=false, staleRevisionRejected=false, missingSafetyLocationRejected=null;
  try { await api.commitRestore({json:data,expectedRevision:before.revision,confirmed:false}); } catch(error) { confirmationRejected=true; }
  // A future revision could become current during a concurrent save. A past revision is always stale.
  try { await api.commitRestore({json:data,expectedRevision:before.revision-1,confirmed:true}); } catch(error) { staleRevisionRejected=true; }
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
if (mode === 'content' && (!report.validContent || report.rejected !== 3 || !report.dataUnchanged))
  process.exitCode = 2
