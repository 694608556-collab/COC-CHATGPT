import { spawnSync } from 'node:child_process'

for (const args of [
  ['scripts/build-web.mjs'],
  ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'ios']
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, COC_PLATFORM: 'ios' }
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
