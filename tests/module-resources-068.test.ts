import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase, CURRENT_SCHEMA_VERSION } from '../src/main/database'
import { AppRepository } from '../src/main/repository'
import { searchOutline } from '../src/shared/record-search'

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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-resources-'))
  directories.push(directory)
  const database = new AppDatabase(path.join(directory, 'coc.sqlite'))
  database.initialize()
  openDatabases.push(database)
  return { repository: new AppRepository(database, path.join(directory, 'archive')), database }
}

describe('0.6.8 module resources', () => {
  it('upgrades an older database to the resource schema', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-resources-v6-'))
    directories.push(directory)
    const file = path.join(directory, 'coc.sqlite')
    const initial = new AppDatabase(file)
    initial.initialize()
    initial.close()

    // 退回到 v5，模拟 0.6.6 留下的库
    const raw = new DatabaseSync(file)
    raw.exec('DROP TABLE IF EXISTS module_resources')
    raw.prepare('UPDATE schema_meta SET version = 5').run()
    raw.close()

    const upgraded = new AppDatabase(file)
    upgraded.initialize()
    openDatabases.push(upgraded)
    const version = (
      upgraded.connection.prepare('SELECT version FROM schema_meta WHERE id = 1').get() as {
        version: number
      }
    ).version
    const table = upgraded.connection
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='module_resources'")
      .get() as { found?: number } | undefined
    upgraded.close()

    expect(version).toBe(CURRENT_SCHEMA_VERSION)
    expect(version).toBeGreaterThanOrEqual(6)
    expect(table?.found).toBe(1)
  })

  it('keeps resources per module and cascades when the module is deleted', () => {
    const { repository } = createRepository()
    const first = repository.createModule({ name: '甲团', playStatus: 'running' })
    const second = repository.createModule({ name: '乙团', playStatus: 'not_started' })

    repository.createResource({
      moduleId: first.id,
      kind: 'mindmap',
      title: '甲团关系图',
      path: 'E:\\maps\\甲团.emmx'
    })
    repository.createResource({
      moduleId: first.id,
      kind: 'link',
      title: 'Notion 笔记',
      url: 'https://www.notion.so/example'
    })
    repository.createResource({ moduleId: second.id, kind: 'file', title: '设定集', path: 'D:\\a.pdf' })

    expect(repository.listResources(first.id)).toHaveLength(2)
    expect(repository.listResources(second.id)).toHaveLength(1)
    expect(repository.listResources()).toHaveLength(3)

    // 删模组要把它的资料一并带走，不能留下孤儿行
    repository.deleteModule(first.id)
    expect(repository.listResources(first.id)).toHaveLength(0)
    expect(repository.listResources()).toHaveLength(1)
  })

  it('orders resources and supports reordering', () => {
    const { repository } = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    const a = repository.createResource({ moduleId: module.id, kind: 'file', title: 'A', path: 'a' })
    const b = repository.createResource({ moduleId: module.id, kind: 'file', title: 'B', path: 'b' })
    const c = repository.createResource({ moduleId: module.id, kind: 'file', title: 'C', path: 'c' })
    expect(repository.listResources(module.id).map((item) => item.title)).toEqual(['A', 'B', 'C'])

    repository.moveResource(c.id, 0)
    expect(repository.listResources(module.id).map((item) => item.title)).toEqual(['C', 'A', 'B'])

    // 越界索引要夹住，不能把顺序写乱
    repository.moveResource(a.id, 99)
    expect(repository.listResources(module.id).map((item) => item.title)).toEqual(['C', 'B', 'A'])
    expect([a, b, c].every((item) => repository.findResource(item.id))).toBe(true)
  })

  it('updates and deletes a single resource', () => {
    const { repository } = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    const resource = repository.createResource({
      moduleId: module.id,
      kind: 'mindmap',
      title: '旧标题',
      path: 'E:\\maps\\x.emmx'
    })

    const updated = repository.updateResource(resource.id, { title: '新标题', note: '讲人物关系' })
    expect(updated.title).toBe('新标题')
    expect(updated.note).toBe('讲人物关系')
    // 没传的字段保持原样
    expect(updated.path).toBe('E:\\maps\\x.emmx')
    expect(updated.kind).toBe('mindmap')

    repository.deleteResource(resource.id)
    expect(repository.listResources(module.id)).toHaveLength(0)
  })

  it('rejects a resource whose module does not exist', () => {
    const { repository } = createRepository()
    expect(() =>
      repository.createResource({
        moduleId: '00000000-0000-4000-8000-000000000000',
        kind: 'file',
        title: 'x',
        path: 'x'
      })
    ).toThrow()
  })

  it('carries resources through the snapshot and backup restore', () => {
    const source = createRepository()
    const module = source.repository.createModule({ name: '甲团', playStatus: 'finished' })
    source.repository.createResource({
      moduleId: module.id,
      kind: 'mindmap',
      title: '关系图',
      path: 'E:\\maps\\a.emmx'
    })
    const snapshot = source.repository.snapshot()
    expect(snapshot.resources).toHaveLength(1)

    // 恢复到另一个库
    const target = createRepository()
    target.repository.replaceFromBackup(snapshot, {
      restoreSettings: false,
      archiveDirectory: path.join(os.tmpdir(), 'unused-archive')
    })
    const restored = target.repository.listResources()
    expect(restored).toHaveLength(1)
    expect(restored[0]!.title).toBe('关系图')
    expect(restored[0]!.kind).toBe('mindmap')
  })

  it('skips resources whose module is absent from the backup instead of failing', () => {
    const { repository } = createRepository()
    const snapshot = repository.snapshot()
    // 备份里带一条孤儿资料：恢复应跳过它，而不是整批失败
    snapshot.resources = [
      {
        id: '00000000-0000-4000-8000-000000000001',
        moduleId: '00000000-0000-4000-8000-000000000002',
        kind: 'file',
        title: '孤儿',
        path: 'x',
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    expect(() =>
      repository.replaceFromBackup(snapshot, {
        restoreSettings: false,
        archiveDirectory: path.join(os.tmpdir(), 'unused-archive')
      })
    ).not.toThrow()
    expect(repository.listResources()).toHaveLength(0)
  })

  it('falls back to a known kind when the stored value is unrecognised', () => {
    const { repository, database } = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    const resource = repository.createResource({
      moduleId: module.id,
      kind: 'file',
      title: 'x',
      path: 'x'
    })
    // 模拟老库/外来备份里的非法 kind：写坏之后读出来必须兜底成已知值
    database.connection
      .prepare('UPDATE module_resources SET kind = ? WHERE id = ?')
      .run('nonsense', resource.id)
    expect(repository.findResource(resource.id).kind).toBe('file')
  })
})

describe('0.6.8 outline search', () => {
  const entries = [
    { resourceId: 'r1', resourceTitle: '龙台掠雪', lines: ['赤月教', '教主：盈蛊', '赤月教护法', '无关节点'] },
    { resourceId: 'r2', resourceTitle: '时间线', lines: ['1999年2月', '人体自燃事件'] }
  ]

  it('counts matched nodes instead of characters', () => {
    const hits = searchOutline(entries, '赤月教')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.resourceId).toBe('r1')
    // 命中 2 个节点（赤月教、赤月教护法），而不是 3 次字符出现
    expect(hits[0]!.matches).toBe(2)
    expect(hits[0]!.lines).toEqual(['赤月教', '赤月教护法'])
  })

  it('ignores blank queries and returns nothing when there is no match', () => {
    expect(searchOutline(entries, '   ')).toEqual([])
    expect(searchOutline(entries, '不存在的词')).toEqual([])
  })

  it('sorts by match count and caps the listed lines', () => {
    const many = [
      {
        resourceId: 'many',
        resourceTitle: '多',
        lines: Array.from({ length: 20 }, (_, index) => `关键词 ${index}`)
      },
      { resourceId: 'few', resourceTitle: '少', lines: ['关键词'] }
    ]
    const hits = searchOutline(many, '关键词')
    expect(hits.map((hit) => hit.resourceId)).toEqual(['many', 'few'])
    expect(hits[0]!.matches).toBe(20)
    // 默认最多列 5 条，避免结果列表被一张导图刷屏
    expect(hits[0]!.lines).toHaveLength(5)
  })

  it('is case insensitive', () => {
    const hits = searchOutline([{ resourceId: 'r', resourceTitle: 't', lines: ['Notion Page'] }], 'notion')
    expect(hits).toHaveLength(1)
  })
})

describe('resource wiring contracts', () => {
  const ipc = read('src/main/ipc.ts')
  const api = read('src/shared/api.ts')
  const preload = read('src/preload/index.ts')
  const packagedPreload = read('resources/preload.cjs')
  const app = read('src/renderer/src/App.tsx')
  // 0.7.0 起资料汇总是独立页面，不再是模组卡片里的内嵌面板
  const component = read('src/renderer/src/components/ResourcesPage.tsx')
  const viewer = read('src/renderer/src/components/MindmapViewer.tsx')
  const database = read('src/main/database.ts')
  const styles = read('src/renderer/src/styles.css')

  it('exposes every resource channel through both preloads', () => {
    for (const channel of [
      'resources:create',
      'resources:update',
      'resources:delete',
      'resources:move',
      'resources:set-module',
      'resources:choose-files',
      'resources:read-mindmap',
      'resources:export-outline',
      'resources:file-icons',
      'resources:open',
      'resources:check-paths'
    ]) {
      expect(ipc).toContain(`'${channel}'`)
    }
    // 两个 preload 必须同步，否则开发时能用、打包后失效
    for (const source of [preload, packagedPreload]) {
      expect(source).toContain('readMindmap:')
      expect(source).toContain('chooseFiles:')
      expect(source).toContain('checkPaths:')
    }
    expect(api).toContain('readMindmap(targetPath: string): Promise<MindmapPreviewApi>')
  })

  it('registers resources in the automatic backup schedule', () => {
    for (const channel of [
      'resources:create',
      'resources:update',
      'resources:delete',
      'resources:move',
      'resources:set-module'
    ]) {
      expect(ipc).toContain(`'${channel}',`)
    }
  })

  it('mounts resources as a top-level page between characters and notes', () => {
    // 0.7.0：从模组内嵌面板提升为左侧导航的一级页面
    expect(app).toContain("import { ResourcesPage } from './components/ResourcesPage'")
    expect(app).toContain('<ResourcesPage')
    expect(app).toContain("type Page = 'records' | 'characters' | 'resources' | 'notes' | 'settings'")
    // 顺序必须是 角色卡 → 资料汇总 → 闲记
    expect(app).toContain("(['records', 'characters', 'resources', 'notes', 'settings'] as const)")
  })

  it('feeds mindmap outlines into the module-wide search', () => {
    // 大纲要预读并缓存，否则同步渲染的搜索拿不到内容
    expect(app).toContain('outlineCache')
    expect(app).toContain('searchOutline')
    expect(app).toContain('moduleOutlineHits')
  })

  it('offers preview and open-in-original-app without pretending to edit', () => {
    // 软件只做索引：编辑交给原程序
    expect(viewer).toContain('用 EdrawMind 打开')
    expect(component).toContain('不会删除原文件')
    expect(component).toContain('用原程序打开')
  })

  it('uses a vector preview rather than the tiny embedded thumbnail', () => {
    // 缩略图只有 210px 左右，放大必糊，所以走解析重建的矢量 SVG
    expect(viewer).toContain('dangerouslySetInnerHTML')
    expect(viewer).toContain('page.svg')
    expect(styles).toContain('.mindmap-canvas svg')
  })

  it('keeps the viewer out of the titlebar drag region', () => {
    const block = styles.slice(styles.indexOf('.mindmap-viewer {'), styles.indexOf('.mindmap-viewer-head'))
    expect(block).toContain('app-region: no-drag')
    expect(block).toContain('-webkit-app-region: no-drag')
  })

  it('marks resources whose file has gone missing', () => {
    // 只记路径，所以文件被移走时要能提示
    expect(component).toContain('checkPaths')
    expect(component).toContain('找不到')
    expect(styles).toContain('.resource-tile.missing')
  })

  it('declares the resource table and its cascade', () => {
    expect(database).toContain('CREATE TABLE IF NOT EXISTS module_resources')
    expect(database).toContain('REFERENCES modules(id) ON DELETE CASCADE')
    expect(database).toContain('if (currentVersion < 6)')
  })
})
