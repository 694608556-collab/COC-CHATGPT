import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

await mkdir('android/app/build/public-capacity', { recursive: true })
const result = await build({
  stdin: {
    contents: `import {searchSample} from './src/dev/sample';
import {createEmptyCharacter} from '../src/shared/coc-rules';
import {writeFileSync} from 'node:fs';
const sample=searchSample();sample.characters=[createEmptyCharacter({edition:7,name:'公开 iOS 角色'})];
writeFileSync('android/app/build/public-capacity/native-sample.json',JSON.stringify(sample));`,
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
})
await writeFile('android/app/build/public-capacity/native-fixture.mjs', result.outputFiles[0].text)
const generated = spawnSync(process.execPath, ['android/app/build/public-capacity/native-fixture.mjs'], {
  stdio: 'inherit'
})
if (generated.status !== 0) process.exit(generated.status ?? 1)
