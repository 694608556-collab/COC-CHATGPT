import { build } from 'esbuild'
import { mkdtemp, lstat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

// Public synthetic fixtures, real disk SQLite string index, constrained JS heap.
// This measures the shared parser on the desktop/CI host, not a phone acceptance.
const temporaryRoot = resolve(tmpdir())
const work = await mkdtemp(join(temporaryRoot, 'coc-table-stream-'))
try {
  const outfile = join(work, 'scale.cjs')
  await build({
    entryPoints: [resolve('tests/table-stream-scale.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['node:sqlite'],
    logLevel: 'warning'
  })
  // Optional smaller sizes are for development only; the default CI evidence
  // always includes an actual XLSX source larger than 512 MiB.
  const sizes = process.argv.slice(2)
  for (const [format, rows] of [
    ['csv', sizes[0] ?? '96'],
    ['xlsx', sizes[1] ?? '512']
  ]) {
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=96', '--expose-gc', outfile, work, format, rows],
      { stdio: 'inherit' }
    )
    const status = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(code ?? signal))
    })
    if (status !== 0) throw new Error(`Table streaming scale check failed: ${format}: ${status}`)
  }
} finally {
  const target = resolve(work)
  if (
    dirname(target) !== temporaryRoot ||
    !basename(target).startsWith('coc-table-stream-') ||
    !(await lstat(target)).isDirectory() ||
    (await lstat(target)).isSymbolicLink()
  )
    throw new Error('Refusing to remove an unexpected temporary path')
  await rm(target, { recursive: true, force: true })
}
