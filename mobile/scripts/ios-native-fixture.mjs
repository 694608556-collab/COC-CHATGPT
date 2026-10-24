import { deflateSync } from 'node:zlib'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

await mkdir('ios/build', { recursive: true })
const result = await build({
  stdin: {
    contents: `import {searchSample} from './src/dev/sample';
import {createEmptyCharacter} from '../src/shared/coc-rules';
import {writeFileSync} from 'node:fs';
const sample=searchSample();sample.characters=[createEmptyCharacter({edition:7,name:'公开 iOS 角色'})];
writeFileSync('ios/build/native-sample.json',JSON.stringify(sample));`,
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
})
await writeFile('ios/build/native-fixture.mjs', result.outputFiles[0].text)
const generated = spawnSync(process.execPath, ['ios/build/native-fixture.mjs'], { stdio: 'inherit' })
if (generated.status !== 0) process.exit(generated.status ?? 1)

// Public repetitive bytes exercise independent native zlib decoding. Never a private input.
await writeFile('ios/build/upload-window.json', JSON.stringify({ rawBytes: 2 * 1024 * 1024,
  base64: deflateSync(Buffer.alloc(2 * 1024 * 1024, 65), { level: 1 }).toString('base64') }))
