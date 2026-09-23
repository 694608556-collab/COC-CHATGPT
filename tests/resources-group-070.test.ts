import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import { AppRepository } from '../src/main/repository'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

const directories: string[] = []
const openDatabases: AppDatabase[] = []

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    try {
      database.close()
    } catch {
      // 已关闭
    }
  }
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createRepository(): AppRepository {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-070-'))
  directories.push(directory)
  const database = new AppDatabase(path.join(directory, 'coc.sqlite'))
  database.initialize()
  openDatabases.push(database)
  return new AppRepository(database, path.join(directory, 'archive'))
}

describe('0.7.0 removing a resource group', () => {
  it('offers the same two choices for module groups and the unassigned group', () => {
    const page = read('src/renderer/src/components/ResourcesPage.tsx')
    // 统一入口：两个按钮都调 removeGroup
    const moduleCall = page.indexOf('removeGroup(name, items, { moduleId: options.module!.id })')
    const unassignedCall = page.indexOf('removeGroup(name, items, { unassigned: true })')
    expect(moduleCall).toBeGreaterThan(0)
    expect(unassignedCall).toBeGreaterThan(0)
    // 两个选项
    expect(page).toContain('只清空资料')
    expect(page).toContain('连分组一起删')
    // 删除对话框里不再有「取消归属」这个中间态（空状态里的拖拽引导文案不算）
    const dialog = page.slice(page.indexOf('const removeGroup'), page.indexOf('const toggle'))
    expect(dialog).not.toContain('取消归属')
    expect(dialog).not.toContain('setModule(resource.id, undefined)')
  })

  it('removing a module group only affects the resources page', () => {
    const repository = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    const record = repository.createRecord({ moduleId: module.id, name: '甲团第 1 场' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: 'A', path: 'a.pdf' })

    // 模拟「连分组一起删」：删资料 + 标记分组已移除
    for (const resource of repository.listResources(module.id)) {
      repository.deleteResource(resource.id)
    }
    repository.hideResourceGroup(module.id)

    // 资料汇总页：分组被标记为已移除
    expect(repository.getSettings().hiddenResourceModules).toContain(module.id)
    expect(repository.listResources(module.id)).toHaveLength(0)

    // 但模组本身、场次都还在（跑团记录页不受影响）
    const snapshot = repository.snapshot()
    expect(snapshot.modules.map((item) => item.id)).toContain(module.id)
    expect(snapshot.records.map((item) => item.id)).toContain(record.id)
  })

  it('keeps the group hidden until new resources are added', () => {
    const repository = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    repository.hideResourceGroup(module.id)
    expect(repository.getSettings().hiddenResourceModules).toContain(module.id)

    // 又给这个模组加资料 → 自动取消移除标记，分组重新出现
    repository.createResource({ moduleId: module.id, kind: 'file', title: '新资料', path: 'new.pdf' })
    expect(repository.getSettings().hiddenResourceModules).not.toContain(module.id)
    expect(repository.listResources(module.id)).toHaveLength(1)
  })

  it('also un-hides when a resource is dragged into that module', () => {
    const repository = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    const orphan = repository.createResource({ kind: 'file', title: '散资料', path: 'x.pdf' })
    repository.hideResourceGroup(module.id)

    repository.setResourceModule(orphan.id, module.id)
    expect(repository.getSettings().hiddenResourceModules).not.toContain(module.id)
  })

  it('"clear only" keeps the group and removes just the resources', () => {
    const repository = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: 'A', path: 'a.pdf' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: 'B', path: 'b.pdf' })

    // 只清空资料，不标记分组已移除
    for (const resource of repository.listResources(module.id)) {
      repository.deleteResource(resource.id)
    }

    expect(repository.listResources(module.id)).toHaveLength(0)
    // 分组仍在（没有被标记移除）
    expect(repository.getSettings().hiddenResourceModules ?? []).not.toContain(module.id)
  })

  it('reaches the blank page only when nothing is visible at all', () => {
    const repository = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: 'A', path: 'a' })
    repository.createResource({ kind: 'file', title: 'B', path: 'b' })

    // 连分组一起删：模组分组 + 未归属组都清掉
    for (const resource of repository.listResources()) repository.deleteResource(resource.id)
    repository.hideResourceGroup(module.id)

    const snapshot = repository.snapshot()
    const hidden = new Set(snapshot.settings.hiddenResourceModules ?? [])
    const visibleGroups = snapshot.modules.filter((item) => !hidden.has(item.id))
    // 界面的空状态条件：没有可见分组 + 没有资料
    expect(visibleGroups).toHaveLength(0)
    expect(snapshot.resources).toHaveLength(0)
  })

  it('carries the hidden list through settings persistence', () => {
    const repository = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    repository.hideResourceGroup(module.id)
    // 重新读一次设置，确认写进了库
    expect(repository.getSettings().hiddenResourceModules).toEqual([module.id])
    // 重复移除不产生重复项
    repository.hideResourceGroup(module.id)
    expect(repository.getSettings().hiddenResourceModules).toEqual([module.id])
  })

  it('exposes the channel through ipc and both preloads', () => {
    const ipc = read('src/main/ipc.ts')
    const api = read('src/shared/api.ts')
    const preload = read('src/preload/index.ts')
    const packaged = read('resources/preload.cjs')
    expect(ipc).toContain("'resources:remove-group'")
    expect(api).toContain('removeGroup(moduleId: string): Promise<AppSettings>')
    for (const source of [preload, packaged]) {
      expect(source).toContain('removeGroup:')
    }
  })
})
