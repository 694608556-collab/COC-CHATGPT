import { transform } from 'esbuild'
import { writeFile } from 'node:fs/promises'

const targets = await (await fetch('http://127.0.0.1:9229/json/list')).json()
const target = targets.find((item) => item.url.startsWith('https://localhost'))
if (!target) throw new Error('Owned development WebView not found')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let sequence = 0
/**
 * Evaluate only our app's DOM/public native contract, translating syntax for its old WebView.
 * @param expression - Owned-app check or ordinary button action; never restore confirmation.
 * @returns The evaluated JSON-safe result, without private log text.
 */
async function evaluate(expression) {
  const id = ++sequence
  const output = await transform(expression, { target: 'chrome69' })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned app UI timeout')), 20000)
    const listener = (event) => {
      const reply = JSON.parse(event.data)
      if (reply.id !== id) return
      clearTimeout(timer)
      socket.removeEventListener('message', listener)
      if (reply.result?.exceptionDetails) reject(new Error('Owned app UI check failed'))
      else resolve(reply.result?.result?.value)
    }
    socket.addEventListener('message', listener)
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression: output.code, awaitPromise: true, returnByValue: true }
      })
    )
  })
}
/**
 * Wait briefly for React rendering/native file I/O, never accepting an error as completion.
 * @param predicate - Expected state in the owned app.
 * @returns No value; throws if the target state is not reached.
 */
async function until(predicate) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate(`Boolean(${predicate})`)) return
    if (await evaluate(`Boolean(document.querySelector('.error'))`)) throw new Error('App showed an error')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('App UI did not reach expected state')
}
const report = {}
if (await evaluate(`Boolean(document.querySelector('[role=dialog]'))`))
  throw new Error('Do not interfere with a pending user confirmation')
await evaluate(`document.querySelectorAll('.bottom-nav button')[0].click()`)
await until(`document.querySelector('.record-card')`)
await evaluate(`document.querySelector('.record-card').click()`)
await until(`document.querySelector('.messages .message')`)
report.reader = await evaluate(
  `({renderedMessages:document.querySelectorAll('.message').length, searchPresent:!!document.querySelector('input[type=search]'), documentWidth:document.documentElement.scrollWidth, viewportWidth:innerWidth})`
)
if (report.reader.renderedMessages !== 100 || report.reader.documentWidth !== report.reader.viewportWidth)
  throw new Error('Reader pagination or mobile width failed')
await evaluate(`document.querySelector('.reader-actions .primary').click()`)
await until(
  `document.querySelector('.notice') && document.querySelector('.notice').textContent.includes('TXT 已保存并回读校验')`
)
report.txtExportPassed = true
await evaluate(`document.querySelectorAll('.bottom-nav button')[2].click()`)
await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='保存安卓备份')`)
await evaluate(
  `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存安卓备份').click()`
)
await until(
  `document.querySelector('.notice') && document.querySelector('.notice').textContent.includes('备份已保存并回读校验')`
)
report.manualBackupPassed = true
await evaluate(`document.querySelectorAll('.bottom-nav button')[1].click()`)
await until(`document.querySelector('.record-card')`)
await evaluate(`document.querySelector('.record-card').click()`)
await until(`document.querySelector('.attribute-grid')`)
report.character = await evaluate(
  `({attributes:document.querySelectorAll('.attribute-grid strong').length,visibleSkills:document.querySelectorAll('.skill-row').length,documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth})`
)
if (report.character.attributes !== 8 || report.character.documentWidth !== report.character.viewportWidth)
  throw new Error('Character card rendering failed')
await evaluate(`document.querySelectorAll('.bottom-nav button')[0].click()`)
socket.close()
await writeFile(
  'F:/AndroidTools/coc-mobile-evidence-20261013/s9-ui-check.json',
  JSON.stringify(report, null, 2)
)
console.log(JSON.stringify(report, null, 2))
