import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const projectRequire = createRequire(path.join(root, 'package.json'))

type PackageManifest = {
  exports?: unknown
  main?: string
  module?: string
  dependencies?: Record<string, string>
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  build: { files: string[]; electronLanguages?: string[] }
}

const manifest = projectRequire(path.join(root, 'scripts/package-files.cjs')) as {
  packageFiles: string[]
  excludePatterns: string[]
}

function globToRegExp(glob: string): RegExp {
  let source = '^'
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index)
    if (char === '*') {
      if (glob.charAt(index + 1) === '*') {
        source += '.*'
        index += 1
      } else {
        source += '[^/]*'
      }
    } else if ('\\^$.|?+()[]{}'.includes(char)) {
      source += '\\' + char
    } else {
      source += char
    }
  }
  return new RegExp(source + '$')
}

const excludeMatchers = manifest.excludePatterns.map(globToRegExp)

function isExcluded(asarPath: string): boolean {
  return excludeMatchers.some((matcher) => matcher.test(asarPath))
}

const runtimeConditions = new Set(['node', 'node-addons', 'import', 'require', 'default'])

function collectExportTargets(value: unknown, targets: string[]): void {
  if (typeof value === 'string') {
    targets.push(value)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith('.') || runtimeConditions.has(key)) collectExportTargets(nested, targets)
  }
}

function runtimeEntries(item: PackageManifest): string[] {
  const targets: string[] = []
  if (item.exports !== undefined) {
    collectExportTargets(item.exports, targets)
  } else {
    if (item.main) targets.push(item.main)
    if (item.module) targets.push(item.module)
  }
  return targets.filter((target) => !target.includes('*'))
}

type ProductionPackage = { name: string; dir: string; manifest: PackageManifest }

function collectProductionPackages(): ProductionPackage[] {
  const packages = new Map<string, ProductionPackage>()
  const queue = Object.keys(pkg.dependencies ?? {}).map((name) => ({ name, from: path.join(root, 'package.json') }))
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || packages.has(current.name)) continue
    let entry = ''
    try {
      entry = createRequire(current.from).resolve(current.name)
    } catch {
      continue
    }
    if (!path.isAbsolute(entry) || !entry.includes(path.join('node_modules', path.sep || '/'))) continue
    let dir = path.dirname(entry)
    while (!fs.existsSync(path.join(dir, 'package.json'))) {
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as PackageManifest
    packages.set(current.name, { name: current.name, dir, manifest })
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      queue.push({ name: dependency, from: path.join(dir, 'package.json') })
    }
  }
  return [...packages.values()]
}

function collectSourceText(): string {
  const chunks: string[] = []
  const stack = [path.join(root, 'src')]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name)
      if (item.isDirectory()) stack.push(full)
      else if (/\.(ts|tsx)$/.test(item.name)) chunks.push(fs.readFileSync(full, 'utf8'))
    }
  }
  return chunks.join('\n')
}

describe('packaging hygiene', () => {
  it('keeps the electron-builder file list in sync with the shared manifest', () => {
    expect(pkg.build.files).toEqual(manifest.packageFiles)
  })

  it('ships only the locales the app needs', () => {
    // electron-builder 默认已是 LZMA 压缩；实测 compression: maximum 只差几十字节，因此不做冗余配置。
    expect(pkg.build.electronLanguages).toEqual(['zh-CN', 'en-US'])
  })

  it('never prunes a runtime entry point of a production dependency', () => {
    const packages = collectProductionPackages()
    expect(packages.length).toBeGreaterThan(20)
    const problems: string[] = []
    for (const item of packages) {
      for (const target of runtimeEntries(item.manifest)) {
        const asarPath = 'node_modules/' + item.name + '/' + target.replace(/^\.\//, '')
        if (isExcluded(asarPath)) problems.push(item.name + ' -> ' + target)
      }
    }
    expect(problems).toEqual([])
  })

  it('drops the duplicate build variants that bloat the installer', () => {
    expect(isExcluded('node_modules/docx/dist/index.iife.js')).toBe(true)
    expect(isExcluded('node_modules/docx/dist/index.umd.cjs')).toBe(true)
    expect(isExcluded('node_modules/xlsx/dist/xlsx.full.min.js')).toBe(true)
    expect(isExcluded('node_modules/zod/src/v4/core/schemas.ts')).toBe(true)
    expect(isExcluded('node_modules/bare-url/prebuilds/linux-x64/bare-url.bare')).toBe(true)
  })

  it('keeps the files the app actually loads at runtime', () => {
    expect(isExcluded('node_modules/xlsx/xlsx.js')).toBe(false)
    expect(isExcluded('node_modules/xlsx/dist/cpexcel.js')).toBe(false)
    expect(isExcluded('node_modules/docx/dist/index.mjs')).toBe(false)
    expect(isExcluded('node_modules/docx/dist/index.cjs')).toBe(false)
    expect(isExcluded('node_modules/zod/index.js')).toBe(false)
    expect(isExcluded('node_modules/bare-url/prebuilds/win32-x64/bare-url.bare')).toBe(false)
    expect(isExcluded('out/renderer/assets/index.js')).toBe(false)
  })

  it('keeps every production dependency referenced by the source', () => {
    const sources = collectSourceText()
    const unused = Object.keys(pkg.dependencies ?? {}).filter(
      (name) => !sources.includes("'" + name + "'") && !sources.includes('"' + name + '"')
    )
    expect(unused).toEqual([])
  })

  it('ships react through the renderer bundle instead of node_modules', () => {
    expect(pkg.dependencies?.react).toBeUndefined()
    expect(pkg.dependencies?.['react-dom']).toBeUndefined()
  })
})
