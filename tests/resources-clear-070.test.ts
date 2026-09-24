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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-clear-070-'))
  directories.push(directory)
  const database = new AppDatabase(path.join(directory, 'coc.sqlite'))
  database.initialize()
  openDatabases.push(database)
  return new AppRepository(database, path.join(directory, 'archive'))
}

describe('0.7.0 clearing the unassigned group', () => {
  it('6. offers a delete button on the unassigned group too', () => {
    const page = read('src/renderer/src/components/ResourcesPage.tsx')
    // 未归属分组也渲染删除按钮（此前只有模组分组有）
    expect(page).toContain('删除未归属分组')
    // 两个分支走同一个入口 removeGroup，只是参数不同
    expect(page).toContain('removeGroup(name, items, { moduleId: options.module!.id })')
    expect(page).toContain('removeGroup(name, items, { unassigned: true })')
  })

  it('uses the same two choices for both kinds of group', () => {
    const page = read('src/renderer/src/components/ResourcesPage.tsx')
    const block = page.slice(page.indexOf('const removeGroup'), page.indexOf('const toggle'))
    // 两个选项对两种分组都生效
    expect(block).toContain('只清空资料')
    expect(block).toContain('连分组一起删')
    expect(block).toContain('secondaryAction')
    // 0.7.1：两种分组都要记「已从本页移除」——未归属分组用 UNASSIGNED_GROUP 哨兵，
    // 0.7.0 时它没有 id、记不下来，所以删完刷新又复活
    expect(block).toContain('const groupKey = options.unassigned ? UNASSIGNED_GROUP : options.moduleId')
    expect(block).toContain('if (groupKey) await window.coc.resources.removeGroup(groupKey)')
  })

  it('removes every unassigned entry without touching the files', () => {
    const repository = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: '归属的', path: 'a.pdf' })
    const orphanA = repository.createResource({ kind: 'file', title: '散A', path: 'b.pdf' })
    const orphanB = repository.createResource({ kind: 'link', title: '散B', url: 'https://x.test' })

    // 模拟界面上的「清空未归属」：逐条删除未归属的资料
    for (const resource of repository.listUnassignedResources()) {
      repository.deleteResource(resource.id)
    }

    expect(repository.listUnassignedResources()).toHaveLength(0)
    // 有归属的资料不受影响
    expect(repository.listResources(module.id)).toHaveLength(1)
    expect(() => repository.findResource(orphanA.id)).toThrow()
    expect(() => repository.findResource(orphanB.id)).toThrow()
  })

  it('falls back to the blank guide only when nothing is left at all', () => {
    const page = read('src/renderer/src/components/ResourcesPage.tsx')
    // 0.7.1：空白引导页的条件是「没有资料、没有可见的模组分组、未归属分组也被删了」。
    // 只要还有分组在（哪怕它下面一条资料都没有）就继续显示分组，
    // 用户才能把资料拖回去。
    expect(page).toContain('groups.byModule.length === 0')
    expect(page).toContain('groups.unassignedHidden')
    expect(page).toContain('!groups.unassignedHidden &&')
  })

  it('reaches the blank state after clearing everything', () => {
    const repository = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: 'A', path: 'a' })
    repository.createResource({ kind: 'file', title: 'B', path: 'b' })

    for (const resource of repository.listResources()) repository.deleteResource(resource.id)
    repository.deleteModule(module.id)

    // 与界面判断一致：两者都空 → 显示空白引导页
    expect(repository.listResources()).toHaveLength(0)
    expect(repository.snapshot().modules).toHaveLength(0)
  })

  it('keeps the group visible while modules remain', () => {
    const repository = createRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: 'A', path: 'a' })

    // 删光资料但保留模组
    for (const resource of repository.listResources()) repository.deleteResource(resource.id)

    expect(repository.listResources()).toHaveLength(0)
    // 模组还在 → 界面仍显示分组，不会跳回空白页
    expect(repository.snapshot().modules).toHaveLength(1)
  })
})
