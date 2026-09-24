/**
 * 0.7.1 修复：「资料汇总」页不得出现「容器渲染了但里面空无一物」的空白页。
 *
 * 用户实测：删掉模组分组与未归属分组后，页面上仅有的 3 条资料全在被隐藏的
 * 模组下，于是分组容器渲染了、两个分组却都不显示，页面一片空白，
 * 连页头的添加界面都被挤没了。
 *
 * 设计原则（本次确立）：
 * - 「已移除」标记只用来隐藏【空分组】，有资料的分组必须始终显示
 * - 空白引导页与分组列表用同一个 visibleCount 判断，不能各算各的
 * - 任何一条资料都必须能在页面上找到位置（归属到已不存在模组的资料兜进未归属）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import { AppRepository } from '../src/main/repository'
import { UNASSIGNED_GROUP } from '../src/shared/types'

const root = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

const directories: string[] = []

function makeRepository(): AppRepository {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-071-blank-'))
  directories.push(directory)
  const database = new AppDatabase(path.join(directory, 'coc.sqlite'))
  database.initialize()
  return new AppRepository(database, path.join(directory, 'archive'))
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    try {
      fs.rmSync(directory, { recursive: true, force: true })
    } catch {
      // Windows 上 sqlite 句柄偶尔还没释放，删不掉就交给系统清理临时目录
    }
  }
})

/**
 * 复刻界面里的分组计算（src/renderer/src/components/ResourcesPage.tsx）。
 *
 * 逻辑刻意与实现保持一致：隐藏标记只对空分组生效，且用 visibleCount
 * 统一决定「显示分组」还是「显示空白引导页」。
 */
function computeGroups(
  modules: Array<{ id: string; name: string }>,
  resources: Array<{ moduleId?: string }>,
  hiddenGroups: string[]
): { byModule: Array<{ key: string; count: number }>; unassigned: number; visibleCount: number } {
  const hidden = new Set(hiddenGroups)
  const known = new Set(modules.map((module) => module.id))
  const byModule = modules
    .map((module) => ({
      key: module.id,
      count: resources.filter((resource) => resource.moduleId === module.id).length
    }))
    .filter((group) => !hidden.has(group.key) || group.count > 0)
  const unassigned = resources.filter(
    (resource) => !resource.moduleId || !known.has(resource.moduleId)
  ).length
  const unassignedVisible = unassigned > 0 || !hidden.has(UNASSIGNED_GROUP)
  return { byModule, unassigned, visibleCount: byModule.length + (unassignedVisible ? 1 : 0) }
}

describe('0.7.1 fix: resources page never goes blank while resources exist', () => {
  it('reproduces the user situation: a hidden group that still holds resources stays visible', () => {
    const repository = makeRepository()
    const module = repository.createModule({ name: '铸形骸', playStatus: 'running' })
    repository.createResource({ moduleId: module.id, kind: 'file', title: '跑团记录', path: 'a.pdf' })
    repository.createResource({ moduleId: module.id, kind: 'mindmap', title: '导图', path: 'b.emmx' })
    // 用户先删了模组分组，又删了未归属分组
    repository.hideResourceGroup(module.id)
    repository.hideResourceGroup(UNASSIGNED_GROUP)

    const hidden = repository.getSettings().hiddenResourceGroups ?? []
    expect(hidden).toContain(module.id)
    expect(hidden).toContain(UNASSIGNED_GROUP)

    // 修复前：byModule=0、unassigned=0 → 页面空白
    const groups = computeGroups(
      [{ id: module.id, name: module.name }],
      repository.listResources(module.id).map((r) => ({ moduleId: r.moduleId })),
      hidden
    )
    // 修复后：有资料的分组照样显示
    expect(groups.byModule).toHaveLength(1)
    expect(groups.visibleCount).toBeGreaterThan(0)
  })

  it('hides a module group only while it is empty', () => {
    const repository = makeRepository()
    const module = repository.createModule({ name: '甲团', playStatus: 'running' })
    repository.hideResourceGroup(module.id)
    const modules = [{ id: module.id, name: module.name }]
    const hidden = repository.getSettings().hiddenResourceGroups ?? []

    // 空分组 → 隐藏
    expect(computeGroups(modules, [], hidden).byModule).toHaveLength(0)

    // 一旦有资料 → 重新出现（hideResourceGroup 的注释里承诺过这一点）
    repository.createResource({ moduleId: module.id, kind: 'file', title: 'x', path: 'x.pdf' })
    const withResource = repository.listResources(module.id).map((r) => ({ moduleId: r.moduleId }))
    expect(computeGroups(modules, withResource, hidden).byModule).toHaveLength(1)
  })

  it('hides the unassigned group only while it is empty', () => {
    const repository = makeRepository()
    repository.hideResourceGroup(UNASSIGNED_GROUP)
    const hidden = repository.getSettings().hiddenResourceGroups ?? []

    expect(computeGroups([], [], hidden).visibleCount).toBe(0)

    // 新建一条未归属资料 → 分组回来（repository 会顺手取消隐藏标记）
    repository.createResource({ kind: 'link', title: '未归属', url: 'https://example.com' })
    const after = repository.getSettings().hiddenResourceGroups ?? []
    expect(computeGroups([], [{ moduleId: undefined }], after).visibleCount).toBe(1)
  })

  it('never loses a resource that points at a module which no longer exists', () => {
    // 例如从旧备份恢复后模组缺失；这类资料也要有地方显示，不能凭空消失
    const groups = computeGroups([], [{ moduleId: '已经不存在的模组id' }], [])
    expect(groups.unassigned).toBe(1)
    expect(groups.visibleCount).toBeGreaterThan(0)
  })

  it('shows the blank guide only when nothing can be rendered at all', () => {
    // 没有任何模组、没有资料、未归属也被删了 → 才显示引导页
    expect(computeGroups([], [], [UNASSIGNED_GROUP]).visibleCount).toBe(0)
    // 还有模组在（哪怕是空的）→ 显示分组。
    // 未归属分组在没被删过时照常显示（0.7.0 起就是这个行为），所以是 2 个。
    expect(computeGroups([{ id: 'm1', name: '甲团' }], [], []).visibleCount).toBe(2)
    // 只剩未归属分组可显示时也要显示
    expect(computeGroups([], [], []).visibleCount).toBe(1)
  })

  describe('the page uses one shared number for both branches', () => {
    it('derives the blank guide and the group list from the same visibleCount', () => {
      const page = read('src/renderer/src/components/ResourcesPage.tsx')
      // 两个分支必须用同一个判断，各算各的就会出现「容器渲染了但里面是空的」
      expect(page).toContain('visibleCount')
      expect(page).toContain('groups.visibleCount === 0 && !draft')
      expect(page).toContain('groups.visibleCount > 0 &&')
      // 旧的、会各算各的写法必须消失
      expect(page).not.toContain('resources.length === 0 &&\n        groups.byModule.length === 0')
    })

    it('keeps the add buttons in the page header, outside the group area', () => {
      // 页头的 + 导图/+ 链接/+ 文件 在 App 的页面头里，不受分组显示与否影响
      const app = read('src/renderer/src/App.tsx')
      expect(app).toContain('+ 导图')
      expect(app).toContain('+ 链接')
      expect(app).toContain('+ 文件')
    })
  })
})
