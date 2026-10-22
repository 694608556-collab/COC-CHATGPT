import { test, expect } from '@playwright/test'
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { exampleBackup } from '../src/data/fixtures'
import { previewBackup } from '../src/data/backup'

test('公开96MiB完整JSON/ZIP在真实Worker逐场往返，界面只收到元数据和证明', async ({ page }) => {
  test.setTimeout(60000)
  const seed = (await previewBackup(new TextEncoder().encode(JSON.stringify(exampleBackup())))).snapshot
  const code = await build({
    stdin: {
      resolveDir: resolve('.'),
      loader: 'ts',
      contents: `
      import './src/data/snapshot-worker-compat';
      import { readBackupJsonStream, writeBackupJsonStream, recordMetadata } from './src/data/backup-stream';
      import { readBackupZipStream, writeBackupZipStream } from './src/data/backup-zip-stream';
      self.onmessage = async ({data:{seed,format}}) => {
        const output = new TransformStream<Uint8Array, Uint8Array>();
        const writer = output.writable.getWriter(), reader = output.readable.getReader();
        try {
          const count = 96, text = '公开😀\\r\\n\\0' + 'x'.repeat(1024*1024);
          function row(i) { return {...seed.records[0],id:'public-'+i,order:i,
            rawContent:{...seed.records[0].rawContent,messages:[{...seed.records[0].rawContent.messages[0],text:i+':'+text+':END-'+i}]}} }
          const metadata = {...seed,records:Array.from({length:count},(_,i)=>recordMetadata(row(i)))};
          async function* records() { for(let i=0;i<count;i++) yield row(i) }
          async function* source() { try { for(;;) { const item = await reader.read(); if(item.done)return; yield item.value } }
            finally { await reader.cancel(); reader.releaseLock() } }
          const maximumBytes = 128*1024*1024;
          const write = (async()=> {
            const proof = format==='json'
              ? await writeBackupJsonStream(metadata,records(),chunk=>writer.write(chunk),{maximumBytes})
              : await writeBackupZipStream(metadata,records(),[],chunk=>writer.write(chunk),{maximumBytes});
            await writer.close(); return proof;
          })();
          let seen = 0;
          const options = {maximumBytes, stageRecord:async(record,index)=> {
            if(index!==seen || JSON.stringify(record)!==JSON.stringify(row(index)))throw Error('Full body mismatch'); seen++;
          }};
          const read = format==='json' ? readBackupJsonStream(source(),options)
            : readBackupZipStream(source(),{...options,maximumExpandedBytes:maximumBytes});
          const [proof,preview] = await Promise.all([write,read]);
          if(JSON.stringify(proof)!==JSON.stringify(preview.source))throw Error('Source proof mismatch');
          self.postMessage({format,bytes:proof.bytes,records:seen,offline:preview.offlineRecords,
            metadataBytes:JSON.stringify(preview.metadata).length,hasBody:preview.metadata.records.some(r=>'rawContent' in r || 'manualContent' in r)});
        } catch(error) { await reader.cancel().catch(()=>{}); await writer.abort().catch(()=>{}); self.postMessage({error:String(error)}); }
      };`
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'chrome69',
    banner: { js: 'var globalThis = self;' }
  })
  await page.route('**/public-backup-stream-worker.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: code.outputFiles[0]!.text })
  )
  await page.goto('/')
  for (const format of ['json', 'zip']) {
    const result = await page.evaluate(
      ({ seed, format }) =>
        new Promise<{
          bytes: number
          records: number
          offline: number
          metadataBytes: number
          hasBody: boolean
        }>((resolve, reject) => {
          const worker = new Worker('public-backup-stream-worker.js')
          worker.onmessage = ({ data }) => {
            worker.terminate()
            data.error ? reject(new Error(data.error)) : resolve(data)
          }
          worker.onerror = (error) => {
            worker.terminate()
            reject(new Error(error.message))
          }
          worker.postMessage({ seed, format })
        }),
      { seed, format }
    )
    expect(result.bytes).toBeGreaterThan(96 * 1024 * 1024)
    expect(result.records).toBe(96)
    expect(result.offline).toBe(96)
    expect(result.metadataBytes).toBeLessThan(100000)
    expect(result.hasBody).toBe(false)
  }
})
