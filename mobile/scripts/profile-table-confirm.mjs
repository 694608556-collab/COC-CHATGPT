import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const scenario = process.argv[2] || 'single'
if (!['single', 'append'].includes(scenario)) throw new Error('Expected single or append scenario')

// Public, metadata-only host benchmark. This does not measure device or bridge time.
await mkdir('ios/build', { recursive: true })
const output = 'ios/build/profile-table-confirm.cjs'
await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
import { importTable } from './src/data/tables'
import { previewBackup } from './src/data/backup'
import { performSnapshotJob } from './src/data/snapshot-job'
import { searchSample } from './src/dev/sample'
import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
async function main() {
const now = '2026-10-21T00:00:00.000Z'
const encoder = new TextEncoder()
const base = searchSample()
base.characters = []
base.modules = Array.from({length:350},(_,i)=>({...base.modules[0],id:'public-module-'+i,name:'公开模组'+i,pairs:[],kps:[],order:i,createdAt:now,updatedAt:now}))
const online = {...base.records[0],rawContent:undefined,manualContent:undefined,fetchedAt:undefined,cacheSourceUrl:undefined,status:'pending'}
base.records = Array.from({length:7000},(_,i)=>({...online,id:'public-online-'+i,moduleId:base.modules[Math.floor(i/20)].id,name:'公开场次'+i,link:'https://log.weizaima.com/?key=public-profile-'+i,sequenceNo:i%20+1,order:i%20,createdAt:now,updatedAt:now}))
const manual = {...base.records[0],sourceType:'manual',status:'manual',link:undefined,dateSource:'none'}
base.records.push(...Array.from({length:50},(_,i)=>({...manual,id:'public-manual-'+i,moduleId:base.modules[i].id,name:'公开手动'+i,sequenceNo:21,order:20})))
const scenario = process.argv[2]
const current = scenario === 'append' ? {...base,modules:base.modules.slice(0,50),records:base.records.filter(r=>base.modules.slice(0,50).some(m=>m.id===r.moduleId))} : base
const csv = scenario === 'append' ? ['模组名,场次名,海豹链接',...Array.from({length:6000},(_,i)=>'公开追加模组'+Math.floor(i/20)+',公开追加场次'+i+',https://log.weizaima.com/?key=public-profile-append-'+i)].join('\\n') : '模组名,场次名,手动保存内容\\n公开模组0,公开手动0,"公开更新首行\\n\\n公开更新末行😀"'
const preview = await importTable(current,encoder.encode(csv),'public-'+scenario+'.csv','records')
assert.equal(preview.updated,scenario === 'append' ? 0 : 1)
assert.equal(preview.next.records.length,7050)
assert.equal(preview.next.records.filter(r=>r.manualContent!==undefined).length,scenario === 'append' ? 0 : 1)
assert.ok(preview.next.records.every(r=>r.rawContent===undefined))
const rows=[]
for(let iteration=0;iteration<6;iteration++) {
  let start=performance.now()
  const copy=structuredClone(preview.next)
  const cloneMs=performance.now()-start
  start=performance.now()
  const input=JSON.stringify(copy)
  const inputJsonMs=performance.now()-start
  start=performance.now()
  const bytes=encoder.encode(input)
  const utf8EncodeMs=performance.now()-start
  start=performance.now()
  const checked=(await previewBackup(bytes)).snapshot
  const fullValidationMs=performance.now()-start
  start=performance.now()
  const json=JSON.stringify(checked)
  const outputJsonMs=performance.now()-start
  const actual=await performSnapshotJob({type:'prepare',snapshot:copy})
  assert.deepEqual(actual.snapshot,checked)
  assert.equal(actual.json,json)
  rows.push({iteration,cloneMs,inputJsonMs,utf8EncodeMs,fullValidationMs,outputJsonMs,totalMs:cloneMs+inputJsonMs+utf8EncodeMs+fullValidationMs+outputJsonMs})
}
const touched=preview.next.records.find(r=>r.id==='public-manual-0')
const oldModules=new Set(current.modules.map(m=>m.id)), oldRecords=new Set(current.records.map(r=>r.id))
const proposedDelta={addedModules:preview.next.modules.filter(m=>!oldModules.has(m.id)),addedCharacters:[],addedRecords:preview.next.records.filter(r=>!oldRecords.has(r.id)),moduleParticipants:[],manualUpdates:scenario === 'append' ? [] : [{id:touched.id,manualContent:touched.manualContent,updatedAt:touched.updatedAt,playDate:touched.playDate,dateSource:touched.dateSource}]}
const median=key=>rows.slice(1).map(row=>row[key]).sort((a,b)=>a-b)[2]
const result={scope:'Windows Node host, public metadata only; no native write, directory permission, bridge, old bodies or phone timing measured',scenario,baseline:{modules:current.modules.length,records:current.records.length,finalModules:preview.next.modules.length,finalRecords:7050,manualUpdates:preview.updated,addedRecords:proposedDelta.addedRecords.length},bytes:{currentFullCandidate:encoder.encode(JSON.stringify(preview.next)).length,proposedDeltaOnly:encoder.encode(JSON.stringify(proposedDelta)).length},medianMs:Object.fromEntries(['cloneMs','inputJsonMs','utf8EncodeMs','fullValidationMs','outputJsonMs','totalMs'].map(key=>[key,median(key)])),samples:rows,deltaStatus:'size comparison only; protocol not implemented; complete native association checks and CAS/authorization/transaction/64MiB rollback remain required'}
writeFileSync('ios/build/public-table-confirm-profile-'+scenario+'.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
`
  },
  outfile: output,
  platform: 'node',
  format: 'cjs',
  bundle: true
})
const result = spawnSync(process.execPath, [output, scenario], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status || 1)
