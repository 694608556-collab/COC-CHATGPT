const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const cacheRoot = path.resolve('work', 'localappdata')
fs.mkdirSync(cacheRoot, { recursive: true })

const isWindows = process.platform === 'win32'
const executable = path.resolve('node_modules', '.bin', `electron-builder${isWindows ? '.cmd' : ''}`)
const args = ['--win', 'portable', '--x64']
const command = isWindows ? process.env.ComSpec || 'cmd.exe' : executable
const commandArgs = isWindows
  ? ['/d', '/c', `node_modules\\.bin\\electron-builder.cmd ${args.join(' ')}`]
  : args
const result = spawnSync(command, commandArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    LOCALAPPDATA: cacheRoot,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false'
  },
  stdio: 'inherit',
  windowsHide: true
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
