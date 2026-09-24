/**
 * 打包脚本（pnpm package）。
 *
 * 不写死 target：交给 package.json 的 build.win.target 决定，
 * 当前配置会同时产出两个文件——
 *   COC跑团记录簿-<版本>-win-x64.exe             免安装版（数据跟着文件夹走）
 *   COC跑团记录簿-<版本>-Windows-x64-Setup.exe   NSIS 安装包（用户自选安装位置）
 *
 * 之所以不在命令行传 target：electron-builder 的命令行 target 会覆盖
 * package.json 里的配置，一旦写死就只剩一种产物了。
 *
 * --config.npmRebuild=false 是必须的：本项目依赖全是纯 JS，不需要重建原生模块，
 * 不跳过的话会卡在 @electron/rebuild 扫描依赖那一步。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const cacheRoot = path.resolve('work', 'localappdata')
fs.mkdirSync(cacheRoot, { recursive: true })

const isWindows = process.platform === 'win32'
const executable = path.resolve('node_modules', '.bin', `electron-builder${isWindows ? '.cmd' : ''}`)
const args = ['--win', '--x64', '--config.npmRebuild=false']
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
