import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 版本一致性：package.json 的版本号必须和 CHANGELOG 最新一条、以及工具脚本里
 * 写死的工作分支对得上。三者不一致时，打包出来的文件名、变更记录、同步脚本
 * 会各说各话，排查起来很费劲。
 */

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')
/** .bat 是 GBK 编码，不能用 utf8 读 */
const readGbk = (rel: string): string =>
  new TextDecoder('gbk').decode(fs.readFileSync(path.join(root, rel)))

describe('version consistency', () => {
  const version = JSON.parse(read('package.json')).version as string

  it('has a CHANGELOG entry for the current version', () => {
    const changelog = read('CHANGELOG.md')
    expect(changelog, `CHANGELOG 里应有 ## ${version} 这一条`).toContain(`## ${version} -`)
  })

  it('keeps CHANGELOG headings in descending version order', () => {
    const versions = [...read('CHANGELOG.md').matchAll(/^## (\d+\.\d+\.\d+) - /gm)].map((m) => m[1]!)
    expect(versions.length).toBeGreaterThan(3)
    // 第一条就是当前版本，且整体从新到旧
    expect(versions[0]).toBe(version)
    const sorted = [...versions].sort((a, b) => {
      const pa = a.split('.').map(Number)
      const pb = b.split('.').map(Number)
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i]! - pa[i]!
      return 0
    })
    expect(versions, 'CHANGELOG 的版本号应从新到旧排列').toEqual(sorted)
  })

  it('points the sync script at the current version branch', () => {
    const bat = readGbk('tools/公司电脑-一键同步并启动开发.bat')
    expect(bat, '同步脚本里的分支名应与当前版本一致').toContain(`set "BRANCH=v${version}"`)
  })

  it('keeps the bat file GBK encoded without a BOM', () => {
    const bytes = fs.readFileSync(path.join(root, 'tools/公司电脑-一键同步并启动开发.bat'))
    // 中文 Windows 的 cmd.exe 解析 UTF-8 批处理会串码，所以必须保持 GBK
    expect([...bytes.subarray(0, 3)]).toEqual([0x40, 0x65, 0x63]) // "@ec" = @echo off
    expect(bytes[0]).not.toBe(0xef)
  })

  it('documents the branch in the tools README', () => {
    expect(read('tools/README.md')).toContain(`v${version}`)
  })
})
