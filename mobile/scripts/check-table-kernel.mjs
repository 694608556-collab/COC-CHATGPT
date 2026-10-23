import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve('ios/build/table-kernel-corpus')
await mkdir(root, { recursive: true })
const entry = resolve(root, 'differential.mjs')
await build({ entryPoints: ['tests/table-kernel-differential.ts'], outfile: entry,
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: "import {createRequire as kernelCreateRequire} from 'node:module'; const require=kernelCreateRequire(import.meta.url);" } })
const probe = process.argv[2] ? resolve(process.argv[2]) : undefined
const result = spawnSync(process.execPath, [entry, root, ...(probe ? [probe] : [])], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
