import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase, CURRENT_SCHEMA_VERSION } from '../src/main/database'
import { AppRepository } from '../src/main/repository'
import { outlineToMarkdown, parseEmmx } from '../src/shared/emmx'
import { samplePath } from './sample-files'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

const directories: string[] = []
const openDatabases: AppDatabase[] = []

afterEach(() => {
  // 先关连接再删目录：SQLite 的 WAL 文件被占着时 rmSync 会报 EPERM
  for (const database of openDatabases.splice(0)) {
    try {
      database.close()
    } catch {
      // 已关闭就忽略
    }
  }
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createRepository(): { repository: AppRepository; database: AppDatabase } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-res-070-'))
  directories.push(directory)
  const database = new AppDatabase(path.join(directory, 'coc.sqlite'))
  database.initialize()
  openDatabases.push(database)
  return { repository: new AppRepository(database, path.join(directory, 'archive')), database }
}

describe('0.7.0 resources may be unassigned', () => {
  it('upgrades a 0.6.8 database so module_id becomes nullable', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-res-v7-'))
    directories.push(directory)
    const file = path.join(directory, 'coc.sqlite')
    const initial = new AppDatabase(file)
    initial.initialize()
    initial.close()

    // 把表退回 0.6.8 的形态（module_id NOT NULL），再让迁移把它改成可空
    const raw = new AppDatabase(file)
    openDatabases.push(raw)
    raw.connection.exec(`
      DROP TABLE IF EXISTS module_resources;
      CREATE TABLE module_resources (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        path TEXT, url TEXT, note TEXT,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    const stamp = '2026-01-01T00:00:00.000Z'
    raw.connection
      .prepare(
        'INSERT INTO modules (id,name,kps_json,pairs_json,sort_order,collapsed,created_at,updated_at,play_status) VALUES (?,?,?,?,?,?,?,?,?)'
      )
      .run('m1', '甲团', '[]', '[]', 0, 0, stamp, stamp, 'running')
    raw.connection
      .prepare(
        'INSERT INTO module_resources (id,module_id,kind,title,path,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run('r1', 'm1', 'file', '旧资料', 'x.pdf', 0, stamp, stamp)
    raw.connection.prepare('UPDATE schema_meta SET version = 6').run()
    raw.close()
    openDatabases.splice(openDatabases.indexOf(raw), 1)

    const upgraded = new AppDatabase(file)
    upgraded.initialize()
    openDatabases.push(upgraded)
    const version = (
      upgraded.connection.prepare('SELECT version FROM schema_meta WHERE id = 1').get() as {
        version: number
      }
    ).version
    // 迁移必须保留原有数据
    const kept = upgraded.connection
      .prepare('SELECT id,module_id,title FROM module_resources')
      .all() as Array<Record<string, unknown>>

    expect(version).toBe(CURRENT_SCHEMA_VERSION)
    expect(version).toBeGreaterThanOrEqual(7)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.title).toBe('旧资料')
    expect(kept[0]!.module_id).toBe('m1')
  })

  it('stores a resource with no module at all', () => {
    const { repository } = createRepository()
    const orphan = repository.createResource({ kind: 'link', title: '散落的链接', url: 'https://x.test' })
    expect(orphan.moduleId).toBeUndefined()
    expect(repository.listUnassignedResources()).toHaveLength(1)

    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: '归属的', path: 'a.pdf' })
    expect(repository.listResources(module.id)).toHaveLength(1)
    // 全部列表里两者都在
    expect(repository.listResources()).toHaveLength(2)
  })

  it('moves a resource between modules and to unassigned', () => {
    const { repository } = createRepository()
    const first = repository.createModule({ name: '甲团', playStatus: 'running' })
    const second = repository.createModule({ name: '乙团', playStatus: 'not_started' })
    const resource = repository.createResource({
      moduleId: first.id,
      kind: 'file',
      title: '资料',
      path: 'a.pdf'
    })

    repository.setResourceModule(resource.id, second.id)
    expect(repository.findResource(resource.id).moduleId).toBe(second.id)
    expect(repository.listResources(first.id)).toHaveLength(0)
    expect(repository.listResources(second.id)).toHaveLength(1)

    // 取消归属
    repository.setResourceModule(resource.id, undefined)
    expect(repository.findResource(resource.id).moduleId).toBeUndefined()
    expect(repository.listUnassignedResources()).toHaveLength(1)
    expect(repository.listResources(second.id)).toHaveLength(0)
  })

  it('keeps unassigned resources when their module is deleted', () => {
    const { repository } = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: '归属的', path: 'a.pdf' })
    const orphan = repository.createResource({ kind: 'file', title: '未归属的', path: 'b.pdf' })

    repository.deleteModule(module.id)
    // 归属的那条随模组消失；未归属的不受影响
    expect(repository.listResources()).toHaveLength(1)
    expect(repository.findResource(orphan.id).title).toBe('未归属的')
  })

  it('numbers the order separately for each owner', () => {
    const { repository } = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: 'A', path: 'a' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: 'B', path: 'b' })
    const orphan = repository.createResource({ kind: 'file', title: 'C', path: 'c' })
    // 未归属那一组的序号从 0 开始，不和模组内序号混在一起
    expect(orphan.sortOrder).toBe(0)
    expect(repository.listResources(module.id).map((item) => item.sortOrder)).toEqual([0, 1])
  })

  it('carries unassigned resources through a backup restore', () => {
    const source = createRepository()
    source.repository.createResource({ kind: 'link', title: '未归属', url: 'https://x.test' })
    const snapshot = source.repository.snapshot()
    expect(snapshot.resources).toHaveLength(1)

    const target = createRepository()
    target.repository.replaceFromBackup(snapshot, {
      restoreSettings: false,
      archiveDirectory: path.join(os.tmpdir(), 'unused-archive')
    })
    const restored = target.repository.listResources()
    expect(restored).toHaveLength(1)
    expect(restored[0]!.moduleId).toBeUndefined()
  })
})

describe('0.7.0 mindmap outline and curves', () => {
  const realFile = samplePath('龙台掠雪')
  const hasReal = realFile !== undefined

  it('reads the hierarchy straight out of the emmx, no markdown export needed', () => {
    // 层级存在 LevelData 的 Super / SubLevel 里，据此就能生成缩进大纲
    const source = read('src/shared/emmx.ts')
    expect(source).toContain('<Super V="')
    expect(source).toContain('<SubLevel V="')
    expect(source).toContain('export function outlineToMarkdown')
  })

  it.skipIf(!hasReal)('builds a nested outline from a real map', () => {
    const document = parseEmmx(fs.readFileSync(realFile!))
    expect(document.outline.length).toBeGreaterThan(100)
    // 必须有真正缩进过的层级，不能全平铺在第 0 层
    const deepest = document.outline.reduce((max, line) => Math.max(max, line.depth), 0)
    expect(deepest).toBeGreaterThanOrEqual(3)
    // 根在第一层
    expect(document.outline[0]!.depth).toBe(0)
  })

  it.skipIf(!hasReal)('draws real curves and keeps group boxes instead of straight lines', () => {
    const document = parseEmmx(fs.readFileSync(realFile!))
    const main = document.pages.find((page) => page.name === 'page/page.xml')!
    // 曲线：path 里必须出现三次贝塞尔指令
    const curves = main.paths.filter((item) => item.d.includes('C'))
    expect(curves.length).toBeGreaterThan(100)
    // 分组框 / 概括括号也要画出来，否则归纳线条全丢
    const boxes = main.paths.filter((item) => item.type !== 'MMConnector' && item.type !== 'RelatConnector')
    expect(boxes.length).toBeGreaterThan(0)
  })

  it.skipIf(!hasReal)('exports the outline as an indented markdown list', () => {
    const document = parseEmmx(fs.readFileSync(realFile!))
    const markdown = outlineToMarkdown(document, '龙台掠雪')
    expect(markdown.startsWith('# 龙台掠雪')).toBe(true)
    expect(markdown).toContain('\n- ')
    // 有缩进就说明层级带过去了
    expect(markdown).toMatch(/\n {2,}- /)
  })
})

describe('0.7.0 page wiring', () => {
  const app = read('src/renderer/src/App.tsx')
  const page = read('src/renderer/src/components/ResourcesPage.tsx')
  const viewer = read('src/renderer/src/components/MindmapViewer.tsx')
  const styles = read('src/renderer/src/styles.css')
  const ipc = read('src/main/ipc.ts')

  it('puts the resources page between characters and notes in the sidebar', () => {
    const marker = "(['records', 'characters', 'resources', 'notes', 'settings'] as const)"
    expect(app).toContain(marker)
    const order = app.slice(app.indexOf(marker), app.indexOf(marker) + 200)
    expect(order.indexOf("'characters'")).toBeLessThan(order.indexOf("'resources'"))
    expect(order.indexOf("'resources'")).toBeLessThan(order.indexOf("'notes'"))
  })

  it('groups resources by module with the unassigned group last', () => {
    expect(page).toContain('未归属模组')
    // 未归属那一组渲染在模组分组之后
    const render = page.slice(page.indexOf('resource-groups'))
    expect(render.indexOf('groups.byModule.map')).toBeLessThan(render.indexOf('未归属模组'))
  })

  it('shows system file icons and image thumbnails', () => {
    expect(page).toContain('fileIcons')
    expect(page).toContain('resource-tile-icon')
    expect(page).toContain('resource-tile-image')
    // 0.7.0：图片缩略图走 readImage 通道。
    // coc-media 协议只允许访问程序自己的 data/notes 目录，资料图片在用户目录里，
    // 用它会 404 显示成破图（这正是 0.6.8 的故障）。
    expect(page).toContain('readImage')
    expect(page).not.toContain('coc-media://')
    expect(ipc).toContain('resources:read-image')
    expect(ipc).toContain('getFileIcon')
  })

  it('reveals tile actions on hover instead of always showing them', () => {
    const rule = styles.slice(
      styles.indexOf('.resource-tile-actions {'),
      styles.indexOf('.resource-tile:hover .resource-tile-actions')
    )
    expect(rule).toContain('opacity: 0')
    expect(styles).toContain('.resource-tile:hover .resource-tile-actions')
    expect(styles).toContain('opacity: 1')
  })

  it('opens tiles on double click', () => {
    expect(page).toContain('onDoubleClick')
  })

  it('fixes the white-on-white buttons in the viewer header', () => {
    // 查看器头部在深色蒙层上，按钮自带深色底；不能再套浅色主题的 .secondary
    expect(viewer).not.toContain('className="secondary"')
    expect(viewer).toContain('mindmap-action')
    const rule = styles.slice(styles.indexOf('.mindmap-tab,'), styles.indexOf('.mindmap-tab:hover'))
    expect(rule).toContain('color: #fff')
    expect(rule).toContain('background: color-mix(in srgb, #fff 18%')
  })

  it('offers an outline tab and an export button', () => {
    expect(viewer).toContain('大纲')
    expect(viewer).toContain('导出大纲')
    expect(viewer).toContain('mindmap-outline')
    expect(viewer).toContain('line.depth')
  })
})
