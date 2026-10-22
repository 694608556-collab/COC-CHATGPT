import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

// Public synthetic data only. A constrained child must never hold the complete
// backup in memory. Keep scale evidence separate from native/device acceptance.
const work = await mkdtemp(join(tmpdir(), 'coc-backup-stream-'))
try {
  const outfile = join(work, 'scale.cjs')
  await build({
    entryPoints: [resolve('tests/backup-stream-scale.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'warning'
  })
  const child = spawn(
    process.execPath,
    ['--max-old-space-size=96', '--expose-gc', outfile, work, ...process.argv.slice(2)],
    { stdio: 'inherit' }
  )
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve(code ?? signal))
  })
  if (status !== 0) throw new Error(`Streaming scale check failed: ${status}`)
} finally {
  await rm(work, { recursive: true, force: true })
}
