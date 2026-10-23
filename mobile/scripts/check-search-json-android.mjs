import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { build as bundle } from 'esbuild'
import { deserialize } from 'node:v8'

// Public, deterministic original-byte cases against the actual production
// library on both ABIs. Only a new owned /data/local/tmp directory is written.
const root=process.cwd(), sdk=process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT
if(!sdk)throw Error('Set ANDROID_HOME or ANDROID_SDK_ROOT to an existing Android SDK')
const suffix=process.platform==='win32'?'.exe':''
const cmake=path.join(sdk,'cmake/3.22.1/bin/cmake'+suffix), ninja=path.join(sdk,'cmake/3.22.1/bin/ninja'+suffix)
const adb=path.join(sdk,'platform-tools/adb'+suffix), ndk=path.join(sdk,'ndk/28.2.13676358')
const parent=process.env.COC_NATIVE_EVIDENCE??path.join(root,'android/build/search-json-device')
const id=crypto.randomUUID(), directory=path.join(parent,id), project=path.join(directory,'project')
fs.mkdirSync(project,{recursive:true})
/** @param tool Existing executable. @param args Literal argv. @returns Complete output, rejecting every failure. */
function run(tool,args){const r=spawnSync(tool,args,{encoding:'utf8',maxBuffer:16*1024*1024});if(r.status!==0)throw Error('Public search JSON verification failed; no private arguments logged');return r.stdout}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const generator=path.join(directory,'public-corpus.cjs')
await bundle({entryPoints:[path.join(root,'tests/search-kernel-corpus.ts')],outfile:generator,bundle:true,platform:'node',format:'cjs',target:'node24',logLevel:'error'})
run(process.execPath,[generator,directory])
const corpusFile=path.join(directory,'public-corpus.jsonl'), expected=deserialize(fs.readFileSync(path.join(directory,'public-corpus.expected.bin')))
fs.writeFileSync(path.join(project,'CMakeLists.txt'),`cmake_minimum_required(VERSION 3.22)
project(coc_search_json_probe LANGUAGES C CXX)
add_subdirectory("${root.replaceAll('\\','/')}/native/table-kernel" "${path.join(directory,'kernel').replaceAll('\\','/')}")
add_executable(probe "${root.replaceAll('\\','/')}/tests/search-json-cli.cpp")
target_compile_features(probe PRIVATE cxx_std_17)
target_include_directories(probe PRIVATE "${root.replaceAll('\\','/')}/native/table-kernel")
target_link_libraries(probe PRIVATE coc_table_kernel)
`)
const devices=run(adb,['devices']).trim().split(/\r?\n/).slice(1)
if(devices.length!==1||!/\sdevice$/.test(devices[0]))throw Error('One authorized device required')
const available=run(adb,['shell','getprop','ro.product.cpu.abilist']).trim().split(',')
if(!['arm64-v8a','armeabi-v7a'].every(abi=>available.includes(abi)))throw Error('Both execution ABIs required')
const remote='/data/local/tmp/coc-search-json-'+id
run(adb,['shell','mkdir',remote])
run(adb,['push',corpusFile,remote+'/public-corpus.jsonl'])
const bodyExpected=deserialize(fs.readFileSync(path.join(directory,'body-corpus.expected.bin')))
assert.equal(bodyExpected.length,423)
run(adb,['push',path.join(directory,'body-corpus.jsonl'),remote+'/body-corpus.jsonl'])
const builds=[]
for(const abi of ['arm64-v8a','armeabi-v7a']){
 const build=path.join(directory,abi)
 fs.writeFileSync(path.join(directory,abi+'-configure.log'),run(cmake,['-S',project,'-B',build,'-G','Ninja','-DCMAKE_MAKE_PROGRAM='+ninja,'-DCMAKE_TOOLCHAIN_FILE='+path.join(ndk,'build/cmake/android.toolchain.cmake'),'-DANDROID_ABI='+abi,'-DANDROID_PLATFORM=android-23','-DANDROID_STL=c++_static','-DCMAKE_BUILD_TYPE=Release']))
 fs.writeFileSync(path.join(directory,abi+'-build.log'),run(cmake,['--build',build,'--target','probe','--parallel','2']))
 const binary=path.join(build,'probe'), target=remote+'/'+abi
 run(adb,['push',binary,target]);run(adb,['shell','chmod','700',target])
 const output=run(adb,['shell',target]);fs.writeFileSync(path.join(directory,abi+'-result.json'),output)
 const result=JSON.parse(output)
 if(result.passed!==true||result.searchJsonCases!==49||result.searchableCases!==16||result.searchScanCases!==384)throw Error('Every original-byte, searchable and scan-boundary case must pass on each ABI')
 const differential=run(adb,['shell',target,'--corpus',remote+'/public-corpus.jsonl'])
 fs.writeFileSync(path.join(directory,abi+'-differential.jsonl'),differential)
 const rows=differential.trimEnd().split(/\r?\n/).map(line=>JSON.parse(line))
 assert.equal(rows.length,expected.length,'Every public differential case must execute')
 for(let index=0;index<expected.length;index++)assert.deepEqual(rows[index],expected[index].expected,abi+' '+expected[index].name)
 const bodyRaw=run(adb,['shell',target,'--body-corpus',remote+'/body-corpus.jsonl'])
 fs.writeFileSync(path.join(directory,abi+'-body-differential.jsonl'),bodyRaw)
 const bodies=bodyRaw.trimEnd().split(/\r?\n/).map(line=>JSON.parse(line))
 assert.equal(bodies.length,bodyExpected.length)
 for(let index=0;index<bodies.length;index++)assert.deepEqual(bodies[index],bodyExpected[index].expected,abi+' '+bodyExpected[index].name)
 builds.push({abi,sha256:hash(binary),...result,publicDifferentialCases:rows.length,publicBodyDifferentialCases:bodies.length})
}
const sources=['native/table-kernel/search-json.cpp','native/table-kernel/search-json.h','tests/search-json-cli.cpp','tests/search-kernel-corpus.ts','scripts/check-search-json-android.mjs'].map(file=>({path:file,sha256:hash(path.join(root,file))}))
const summary={passed:true,builds,sources,publicCorpusSha256:hash(corpusFile),remote}
fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(summary,null,2))
console.log(JSON.stringify({directory,...summary}))
