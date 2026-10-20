const fs = require('node:fs')
const [port, output, scope = 'all', cycles = '3'] = process.argv.slice(2)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  if (
    !output ||
    fs.existsSync(output) ||
    !['all', 'last'].includes(scope) ||
    !Number.isInteger(Number(cycles)) ||
    Number(cycles) < 1 ||
    Number(cycles) > 10
  )
    throw Error('Use PORT NEW_OUTPUT_JSON all|last CYCLES(1-10)')
  const c = await require('./android-webview-cdp.cjs')(port),
    started = Date.now(),
    report = {
      port,
      scope,
      cycles: Number(cycles),
      network: 'local generated responses; no remote requests',
      heapSamplePeriodMs: 2000,
      samples: [],
      rounds: []
    }
  try {
    const safe = await c.evaluate(
      `(async()=>{const state=await window.Capacitor.nativePromise('Logbook','getOverview',{});const data=JSON.parse(state.json);return data.modules.length===50&&data.records.length===1050&&data.modules.every(m=>/^public-module-\\d+$/.test(m.id))&&data.records.every(r=>/^public-(?:record|manual)-\\d+$/.test(r.id))})()`
    )
    if (!safe) throw Error('Refusing to test a library other than the generated public fixture')
    await c.evaluate(`(()=>{
   const inherited=Boolean(window.__publicScale);
   const original=window.Capacitor.nativePromise.bind(window.Capacitor);
   const counts=window.__publicScale || (window.__publicScale={});Object.assign(counts,{fetch:0,staged:0,commits:0,wholeReads:0,failed:0});
   window.Capacitor.nativePromise=async(plugin,method,args)=>{
    if(plugin==='Logbook'){
     if(!inherited&&(method==='createExportSource'||method==='getState'||method==='getRecordContent'))counts.wholeReads++;
     if(!inherited&&method==='stageFetchResult')counts.staged++;
     if(!inherited&&method==='finishFetchBatch')counts.commits++;
     if(method==='fetchLog'){
      counts.fetch++;const index=Number(new URL(args.url).searchParams.get('key').split('-').at(-1));
      const failed=index%17===0;if(failed)counts.failed++;
      await new Promise(resolve=>setTimeout(resolve,1));
      return {url:'https://dice-api.weizaima.com/dice/api/load_data',status:failed?503:200,text:JSON.stringify({messages:[{nickname:'公开主持人',content:'PUBLIC RESULT '+index+' '+ 'B'.repeat(24000)+'中文😀末尾'}]})};
     }
    }return original(plugin,method,args);
   };return true;
  })()`)
    for (let round = 0; round < Number(cycles); round++) {
      await c.evaluate(
        `(()=>{if(document.querySelector('.batch-check'))return;const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='批量检测');if(!b)throw Error('Batch button missing');b.click()})()`
      )
      await delay(100)
      const selected = await c.evaluate(
        `(()=>{const boxes=[...document.querySelectorAll('.check-selector input[type=checkbox]')];if(boxes.length!==50)throw Error('Expected fifty campaign selectors: '+boxes.length);const selected=${JSON.stringify(scope)}==='all'?boxes:[boxes.at(-1)];boxes.forEach(b=>{if(b.checked!==selected.includes(b))b.click()});return selected.length})()`
      )
      await delay(100)
      await c.evaluate(
        `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='开始检测');if(!b||b.disabled)throw Error('Start button disabled');b.click()})()`
      )
      let completed = false
      for (let iteration = 0; iteration < 240; iteration++) {
        await delay(500)
        const state = await c.evaluate(
          `({done:[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='检测完毕'),error:document.querySelector('.batch-check .warning-text')?.textContent,counts:{...window.__publicScale}})`
        )
        if (iteration % 4 === 0) {
          const heap = await c.send('Runtime.getHeapUsage')
          report.samples.push({ elapsed: Date.now() - started, heap: heap.usedSize, counts: state.counts })
          console.log(
            JSON.stringify({
              round: round + 1,
              selected,
              elapsed: Date.now() - started,
              ...state.counts,
              v8MiB: Math.round(heap.usedSize / 1048576)
            })
          )
        }
        if (state.error) throw Error(state.error)
        if (state.done) {
          completed = true
          report.rounds.push({ round: round + 1, selected, counts: state.counts })
          break
        }
      }
      if (!completed) throw Error('Batch did not complete within 120 seconds')
      await c.evaluate(
        `([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='检测完毕')).click()`
      )
      await delay(100)
    }
    const state = await c.evaluate(
      `(async()=>{const s=await window.Capacitor.nativePromise('Logbook','getOverview',{});const data=JSON.parse(s.json);return {revision:s.revision,records:data.records.length,deferred:s.deferredRecordIds.length,manual:data.records.filter(r=>r.sourceType==='manual').length,counts:window.__publicScale}})()`
    )
    const expected = Number(cycles) * (scope === 'all' ? 1000 : 20)
    if (
      state.records !== 1050 ||
      state.deferred !== 1050 ||
      state.manual !== 50 ||
      state.counts.fetch !== expected ||
      state.counts.staged !== expected ||
      state.counts.commits !== Number(cycles) ||
      state.counts.wholeReads !== 0
    )
      throw Error('Coverage or bounded-read check failed: ' + JSON.stringify(state))
    report.success = true
    report.final = state
    report.peakV8Bytes = Math.max(...report.samples.map((x) => x.heap))
    console.log(
      JSON.stringify({
        success: true,
        elapsed: Date.now() - started,
        peakV8MiB: Math.round(report.peakV8Bytes / 1048576),
        ...state
      })
    )
  } finally {
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' })
    c.close()
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
