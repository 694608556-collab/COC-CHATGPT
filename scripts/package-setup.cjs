/**
 * 只打安装包的脚本（pnpm package:setup）。
 *
 * 给朋友测试时用这个产物：走安装向导、用户自选安装位置、自动建快捷方式，
 * 数据存在用户目录（卸载重装不丢）。免安装版请用 pnpm package。
 *
 * 注意：命令行显式传 nsis 会覆盖 package.json 的 build.win.target，
 * 所以这里只会产出 Setup.exe，不会同时产出 portable——这正是本脚本的用途。
 *
 * --config.npmRebuild=false 同 package.cjs：依赖全是纯 JS，跳过原生模块重建，
 * 否则会卡在 @electron/rebuild 扫描那一步。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const cacheRoot = path.resolve('work', 'localappdata')
fs.mkdirSync(cacheRoot, { recursive: true })

const isWindows = process.platform === 'win32'
const executable = path.resolve('node_modules', '.bin', `electron-builder${isWindows ? '.cmd' : ''}`)
const args = ['--win', 'nsis', '--x64', '--config.npmRebuild=false']
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
