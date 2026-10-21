import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
const scenario = process.argv[2] || 'single'
if (!['single', 'append', 'participants', 'characters'].includes(scenario))
  throw new Error('Expected single, append, participants or characters scenario')
const mode = process.argv[3]
if (mode && !['delta-v1', 'production'].includes(mode)) throw new Error('Expected delta-v1 or production mode')

// Public, metadata-only host benchmark. This does not measure device or bridge time.
await mkdir('ios/build', { recursive: true })
const output = 'ios/build/profile-table-confirm.cjs'
await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
import { importTable } from './src/data/tables'
import { createTableDelta, applyTableDelta } from './src/data/table-delta'
import { previewBackup } from './src/data/backup'
import { performSnapshotJob } from './src/data/snapshot-job'
import { searchSample } from './src/dev/sample'
import { strict as assert } from 'node:assert'
import { isDeepStrictEqual } from 'node:util'
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
const selectedCsv = scenario === 'participants' ? '模组名,场次名,手动保存内容,KP1,PC1,PL1\\n公开模组0,公开手动0,"公开更新首行\\n\\n公开更新末行😀",公开主持人,公开新姓名,公开玩家' : scenario === 'characters' ? '姓名,公开差量新角色,职业,医生\\n年龄,26,性别,女\\nSTR,60,CON,55,SIZ,50,DEX,65\\nAPP,50,INT,70,POW,55,EDU,75' : csv
const preview = await importTable(current,encoder.encode(selectedCsv),'public-'+scenario+'.csv',scenario === 'characters'?'characters':'records')
const manualCount = ['single','participants'].includes(scenario)?1:0
assert.equal(preview.updated,manualCount)
assert.equal(preview.next.records.length,7050)
assert.equal(preview.next.records.filter(r=>r.manualContent!==undefined).length,manualCount)
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
if(process.argv[3]==='production') {
  const before=(await performSnapshotJob({type:'prepare',snapshot:current})).snapshot
  const after=(await performSnapshotJob({type:'prepare',snapshot:preview.next})).snapshot
  const delta=createTableDelta(before,after)
  assert.deepEqual(applyTableDelta(delta,before,after.exportedAt),after)
  const result={scope:'Production delta encoder on Windows Node public metadata; not native or device timing',scenario,records:after.records.length,fullBytes:encoder.encode(JSON.stringify(after)).length,deltaBytes:encoder.encode(JSON.stringify(delta)).length,counts:Object.fromEntries(['modulesAdded','moduleParticipants','charactersAdded','recordsAdded','manualUpdates'].map(key=>[key,delta[key].length])),completeReconstructionEqual:true}
  writeFileSync('ios/build/public-table-delta-production-'+scenario+'.json',JSON.stringify(result,null,2))
  console.log(JSON.stringify(result));return
}
const oldModules=new Set(current.modules.map(m=>m.id)), oldRecords=new Set(current.records.map(r=>r.id)), oldCharacters=new Set(current.characters.map(c=>c.id))
const proposedDelta={addedModules:preview.next.modules.filter(m=>!oldModules.has(m.id)),addedCharacters:preview.next.characters.filter(c=>!oldCharacters.has(c.id)),addedRecords:preview.next.records.filter(r=>!oldRecords.has(r.id)),moduleParticipants:scenario==='participants'?[preview.next.modules[0]]:[],manualUpdates:manualCount ? [{id:touched.id,manualContent:touched.manualContent,updatedAt:touched.updatedAt,playDate:touched.playDate,dateSource:touched.dateSource}] : []}
let deltaV1
if(process.argv[3]==='delta-v1') {
  const before=(await performSnapshotJob({type:'prepare',snapshot:current})).snapshot
  const expected=await performSnapshotJob({type:'prepare',snapshot:preview.next})
  const after=expected.snapshot
  const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)))
  const samePrefix=(kind)=> {
    assert.ok(after[kind].length>=before[kind].length)
    before[kind].forEach((item,index)=>assert.equal(after[kind][index].id,item.id))
  }
  for(const kind of ['modules','characters','records']) samePrefix(kind)
  assert.deepEqual(before.settings,after.settings)
  before.characters.forEach((old,index)=>assert.deepEqual(old,after.characters[index]))
  const moduleParticipants=before.modules.flatMap((old,index)=> {
    const next=after.modules[index]
    assert.deepEqual(without(old,['kps','pairs']),without(next,['kps','pairs']))
    return isDeepStrictEqual(old,next)?[]:[next]
  })
  const manualUpdates=before.records.flatMap((old,index)=> {
    const next=after.records[index]
    if(isDeepStrictEqual(old,next)) return []
    assert.equal(old.sourceType,'manual')
    assert.equal(typeof next.manualContent,'string')
    assert.deepEqual(without(old,['manualContent','updatedAt','playDate','dateSource']),without(next,['manualContent','updatedAt','playDate','dateSource']))
    return [next]
  })
  const proposal={protocolVersion:1,modulesAdded:after.modules.slice(before.modules.length),moduleParticipants,charactersAdded:after.characters.slice(before.characters.length),recordsAdded:after.records.slice(before.records.length),manualUpdates}
  assert.ok([...proposal.recordsAdded,...manualUpdates].every(record=>record.rawContent===undefined))
  const rebuilt=structuredClone(before)
  const modules=new Map(moduleParticipants.map(value=>[value.id,value]))
  const records=new Map(manualUpdates.map(value=>[value.id,value]))
  rebuilt.modules=[...before.modules.map(value=>modules.get(value.id)??value),...proposal.modulesAdded]
  rebuilt.records=[...before.records.map(value=>records.get(value.id)??value),...proposal.recordsAdded]
  rebuilt.characters=[...before.characters,...proposal.charactersAdded]
  // Compare the pre-commit candidate at its own timestamp. A real native commit
  // must still replace exportedAt with confirmation time, as the current path does.
  rebuilt.exportedAt=after.exportedAt
  assert.deepEqual(rebuilt,after)
  const checked=await performSnapshotJob({type:'prepare',snapshot:rebuilt})
  assert.deepEqual(checked.snapshot,expected.snapshot)
  assert.equal(checked.json,expected.json)
  const json=JSON.stringify(proposal)
  deltaV1={scope:'Read-only complete-entity proposal reconstruction, no native protocol or write implementation',utf8Bytes:encoder.encode(json).length,operationCounts:Object.fromEntries(['modulesAdded','moduleParticipants','charactersAdded','recordsAdded','manualUpdates'].map(key=>[key,proposal[key].length])),metadataAndExplicitBodiesEqual:true,fullWorkerValidationAndEncodedJSONEqual:true,commitTimestamp:'native-owned at actual confirmation; preview timestamp used only for candidate equivalence',wireOverhead:'Does not include a real bridge envelope, expectedRevision or capability/preview token fields'}
}
const median=key=>rows.slice(1).map(row=>row[key]).sort((a,b)=>a-b)[2]
const result={scope:'Windows Node host, public metadata only; no native write, directory permission, bridge, old bodies or phone timing measured',scenario,baseline:{modules:current.modules.length,records:current.records.length,finalModules:preview.next.modules.length,finalRecords:7050,manualUpdates:preview.updated,addedRecords:proposedDelta.addedRecords.length},bytes:{currentFullCandidate:encoder.encode(JSON.stringify(preview.next)).length,proposedDeltaOnly:encoder.encode(JSON.stringify(proposedDelta)).length},...(deltaV1?{deltaV1}:{}),medianMs:Object.fromEntries(['cloneMs','inputJsonMs','utf8EncodeMs','fullValidationMs','outputJsonMs','totalMs'].map(key=>[key,median(key)])),samples:rows,deltaStatus:'size comparison only; protocol not implemented; complete native association checks and CAS/authorization/transaction/64MiB rollback remain required'}
writeFileSync('ios/build/public-table-confirm-profile-'+(deltaV1?'delta-v1-':'')+scenario+'.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
`
  },
  outfile: output,
  platform: 'node',
  format: 'cjs',
  nodePaths: [resolve('node_modules')],
  bundle: true
})
const result = spawnSync(process.execPath, [output, scenario, ...(mode ? [mode] : [])], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status || 1)
