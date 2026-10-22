import { build } from 'esbuild'
import { mkdtemp, lstat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const temporaryRoot = resolve(tmpdir())
const work = await mkdtemp(join(temporaryRoot, 'coc-single-record-'))
try {
  const outfile = join(work, 'single.cjs')
  await build({
    entryPoints: [resolve('tests/single-record-scale.ts')],
    outfile,
    bundle: true,
    nodePaths: [resolve('node_modules')],
    platform: 'node',
    format: 'cjs',
    logLevel: 'warning'
  })
  // Complete individual records still need real object/string memory. This is
  // an explicit measured runtime resource, never a production record quota.
  const child = spawn(
    process.execPath,
    ['--max-old-space-size=1024', '--expose-gc', outfile, work, ...process.argv.slice(2)],
    { stdio: 'inherit' }
  )
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? signal))
  })
  if (status !== 0) throw new Error(`Single-record resource check failed: ${status}`)
} finally {
  const target = resolve(work),
    info = await lstat(target)
  if (
    dirname(target) !== temporaryRoot ||
    !basename(target).startsWith('coc-single-record-') ||
    !info.isDirectory() ||
    info.isSymbolicLink()
  )
    throw new Error('Refusing to remove unexpected temporary path')
  await rm(target, { recursive: true, force: true })
}
