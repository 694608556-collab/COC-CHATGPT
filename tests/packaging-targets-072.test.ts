/**
 * 打包产物的契约测试。
 *
 * 0.7.2 起每次打包同时产出两个文件：
 * - COC跑团记录簿-<版本>-win-x64.exe              免安装版（数据跟着文件夹走）
 * - COC跑团记录簿-<版本>-Windows-x64-Setup.exe    NSIS 安装包（用户自选安装位置）
 *
 * 这里锁住的关键点：命令行不能写死 target，否则会覆盖 package.json 的配置，
 * 只剩一种产物——这正是修之前的真实故障（package.cjs 里写死了 portable）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')
const pkg = JSON.parse(read('package.json')) as {
  build: {
    win: { target: Array<{ target: string; arch: string[] }> }
    nsis: Record<string, unknown>
    portable: Record<string, unknown>
    electronLanguages: string[]
  }
}

describe('0.7.2 packaging: portable + installer', () => {
  it('builds both a portable exe and an nsis installer', () => {
    const targets = pkg.build.win.target.map((item) => item.target)
    expect(targets).toContain('portable')
    expect(targets).toContain('nsis')
    // 两者都要 x64
    for (const item of pkg.build.win.target) {
      expect(item.arch).toEqual(['x64'])
    }
  })

  it('lets the user choose the install directory', () => {
    const nsis = pkg.build.nsis
    // 有安装向导（不是一键静默）
    expect(nsis.oneClick).toBe(false)
    // 装到当前用户，不需要管理员权限
    expect(nsis.perMachine).toBe(false)
    // 用户可自选安装位置
    expect(nsis.allowToChangeInstallationDirectory).toBe(true)
    // 建快捷方式，朋友不用自己去文件夹里找
    expect(nsis.createDesktopShortcut).toBe(true)
    expect(nsis.createStartMenuShortcut).toBe(true)
  })

  it('names the two artifacts differently so they cannot be confused', () => {
    const portableName = String(pkg.build.portable.artifactName)
    const nsisName = String(pkg.build.nsis.artifactName)
    expect(portableName).toContain('win-x64')
    expect(nsisName).toContain('Windows-x64-Setup')
    expect(portableName).not.toBe(nsisName)
  })

  it('does not hardcode a target in the packaging scripts', () => {
    // 命令行传了 target 会覆盖 package.json；package.cjs 必须只限定平台与架构
    const script = read('scripts/package.cjs')
    const argsLine = script.split('\n').find((line) => line.includes("const args = ["))!
    expect(argsLine).toBeDefined()
    expect(argsLine).toContain("'--win'")
    expect(argsLine).toContain("'--x64'")
    expect(argsLine).not.toContain("'portable'")
    expect(argsLine).not.toContain("'nsis'")
    // 必须跳过原生模块重建，否则会卡在 @electron/rebuild
    expect(argsLine).toContain('npmRebuild=false')
  })

  it('keeps the installer-only script for one-off builds', () => {
    const script = read('scripts/package-setup.cjs')
    const argsLine = script.split('\n').find((line) => line.includes("const args = ["))!
    // 这个脚本专门只打安装包，所以显式指定 nsis 是对的
    expect(argsLine).toContain("'nsis'")
    expect(argsLine).toContain('npmRebuild=false')
  })

  it('keeps only the two needed locales to limit size', () => {
    expect(pkg.build.electronLanguages).toEqual(['zh-CN', 'en-US'])
  })

  it('ships no code signature, which is why SmartScreen warns', () => {
    // 未签名是当前状态；朋友首次运行会看到「已保护你的电脑」，
    // 需要点「更多信息 → 仍要运行」。改签名要买证书，这里只是把现状记下来。
    const build = JSON.parse(read('package.json')).build
    expect(build.win.signExecutable).toBe(false)
  })
})
