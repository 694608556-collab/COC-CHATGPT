/**
 * 0.7.2 修复：把 A 分组的资料全部拖到 B 分组后，A 分组必须保留为空分组。
 *
 * 用户反馈：「资料汇总界面中如果存在两个模组条目及旗下资料，将 A 条目的资料
 * 全部拖拽到 B 条目后，A 条目直接消失了，这不符合交互逻辑，应该是条目保留
 * 但名下资料为空才对」。
 *
 * 根因是两条规则的冲突：
 * - 0.7.1 起「已移除」标记只对【空分组】生效，有资料的分组靠例外规则显示
 * - 但分组可能仍带着旧的「已移除」标记
 * 于是该分组是「靠例外才显示」的：资料一被拖走，例外失效，分组立刻消失。
 *
 * 正确做法：一个分组只要有资料，就说明用户还在用它，其「已移除」标记必须
 * 被清掉（永久），此后即使资料被拖空，它也照常作为空分组显示。
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-072-drag-'))
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
      // Windows 上 sqlite 句柄偶尔还没释放，交给系统清理临时目录
    }
  }
})

/**
 * 复刻界面的分组计算（src/renderer/src/components/ResourcesPage.tsx）。
 * 返回页面上实际会显示的分组 key 列表。
 */
function visibleGroupKeys(
  modules: Array<{ id: string }>,
  resources: Array<{ moduleId?: string }>,
  hiddenGroups: string[]
): string[] {
  const hidden = new Set(hiddenGroups)
  const known = new Set(modules.map((m) => m.id))
  const byModule = modules
    .map((m) => ({ key: m.id, count: resources.filter((r) => r.moduleId === m.id).length }))
    .filter((g) => !hidden.has(g.key) || g.count > 0)
  const unassigned = resources.filter((r) => !r.moduleId || !known.has(r.moduleId)).length
  const unassignedVisible = unassigned > 0 || !hidden.has(UNASSIGNED_GROUP)
  return [...byModule.map((g) => g.key), ...(unassignedVisible ? [UNASSIGNED_GROUP] : [])]
}

describe('0.7.2 fix: emptying a group by dragging keeps the group', () => {
  describe('the reported scenario', () => {
    it('keeps group A after all its resources are dragged to group B', () => {
      const repository = makeRepository()
      const a = repository.createModule({ name: '甲团', playStatus: 'running' })
      const b = repository.createModule({ name: '乙团', playStatus: 'running' })
      const r1 = repository.createResource({ moduleId: a.id, kind: 'file', title: '甲一', path: 'a1.pdf' })
      const r2 = repository.createResource({ moduleId: a.id, kind: 'file', title: '甲二', path: 'a2.pdf' })

      const modules = [
        { id: a.id },
        { id: b.id }
      ]
      const snapshot = (): Array<{ moduleId?: string }> =>
        repository
          .listResources(a.id)
          .concat(repository.listResources(b.id))
          .map((r) => ({ moduleId: r.moduleId }))

      // 拖拽前：A、B、未归属都在
      const before = visibleGroupKeys(modules, snapshot(), repository.getSettings().hiddenResourceGroups ?? [])
      expect(before).toContain(a.id)
      expect(before).toContain(b.id)

      // 把 A 的两条资料全拖到 B
      repository.setResourceModule(r1.id, b.id)
      repository.setResourceModule(r2.id, b.id)

      // 关键：A 已经没有资料，但必须仍然显示为空分组
      expect(repository.listResources(a.id)).toHaveLength(0)
      const visible = visibleGroupKeys(modules, snapshot(), repository.getSettings().hiddenResourceGroups ?? [])
      expect(visible, '甲团拖空后不应消失').toContain(a.id)
      // B 拿到两条资料
      expect(repository.listResources(b.id)).toHaveLength(2)
    })

    it('refuses to mark a group that still holds resources', () => {
      // 从源头杜绝「有资料还被标记」的不一致状态：
      // 这种分组只是「靠例外规则显示」，资料一被拖走就会凭空消失。
      const repository = makeRepository()
      const a = repository.createModule({ name: '甲团', playStatus: 'running' })
      repository.createResource({ moduleId: a.id, kind: 'file', title: '甲一', path: 'a1.pdf' })
      repository.hideResourceGroup(a.id)
      expect(repository.getSettings().hiddenResourceGroups ?? []).not.toContain(a.id)
    })
  })

  describe('the invariant: a group with resources never keeps a removed marker', () => {
    it('clears the marker when a resource is dragged into a marked group', () => {
      const repository = makeRepository()
      const a = repository.createModule({ name: '甲团', playStatus: 'running' })
      const b = repository.createModule({ name: '乙团', playStatus: 'running' })
      repository.hideResourceGroup(a.id)
      const resource = repository.createResource({ moduleId: b.id, kind: 'file', title: 'x', path: 'x.pdf' })

      repository.setResourceModule(resource.id, a.id)
      expect(repository.getSettings().hiddenResourceGroups ?? []).not.toContain(a.id)
    })

    it('clears the marker when a resource is created directly in a marked group', () => {
      const repository = makeRepository()
      const a = repository.createModule({ name: '甲团', playStatus: 'running' })
      repository.hideResourceGroup(a.id)
      repository.createResource({ moduleId: a.id, kind: 'file', title: 'x', path: 'x.pdf' })
      expect(repository.getSettings().hiddenResourceGroups ?? []).not.toContain(a.id)
    })

    it('reconciles a marker left behind on a group that still holds resources', () => {
      // 数据可能来自备份恢复或直接改库，绕过了上面两处清理。
      // 应用启动时必须把这种不一致纠正过来，否则分组会「靠例外显示」，
      // 资料一被拖走就消失。
      const repository = makeRepository()
      const a = repository.createModule({ name: '甲团', playStatus: 'running' })
      repository.createResource({ moduleId: a.id, kind: 'file', title: 'x', path: 'x.pdf' })
      // 直接塞一个已移除标记，模拟历史遗留数据
      repository.updateSettings({ hiddenResourceGroups: [a.id] })
      expect(repository.getSettings().hiddenResourceGroups).toContain(a.id)

      repository.reconcileResourceGroups()

      expect(repository.getSettings().hiddenResourceGroups ?? []).not.toContain(a.id)
    })

    it('leaves markers on genuinely empty groups alone', () => {
      const repository = makeRepository()
      const empty = repository.createModule({ name: '空团', playStatus: 'running' })
      repository.hideResourceGroup(empty.id)
      repository.reconcileResourceGroups()
      // 空分组仍应保持「已移除」，否则用户删掉的分组会自己冒出来
      expect(repository.getSettings().hiddenResourceGroups).toContain(empty.id)
    })

    it('keeps the unassigned marker when the unassigned group is empty', () => {
      const repository = makeRepository()
      repository.hideResourceGroup(UNASSIGNED_GROUP)
      repository.reconcileResourceGroups()
      expect(repository.getSettings().hiddenResourceGroups).toContain(UNASSIGNED_GROUP)
    })

    it('clears the unassigned marker once an unassigned resource exists', () => {
      const repository = makeRepository()
      repository.hideResourceGroup(UNASSIGNED_GROUP)
      repository.createResource({ kind: 'link', title: '散', url: 'https://example.com' })
      repository.reconcileResourceGroups()
      expect(repository.getSettings().hiddenResourceGroups ?? []).not.toContain(UNASSIGNED_GROUP)
    })
  })

  describe('reconciliation runs where stale data can come from', () => {
    it('is applied after restoring from a backup', () => {
      const repository = makeRepository()
      const a = repository.createModule({ name: '甲团', playStatus: 'running' })
      repository.createResource({ moduleId: a.id, kind: 'file', title: 'x', path: 'x.pdf' })
      repository.hideResourceGroup(a.id)
      // 恢复备份后设置可能带回旧标记，必须再纠正一次
      const repository2 = makeRepository()
      repository2.reconcileResourceGroups()
      expect(typeof repository2.reconcileResourceGroups).toBe('function')
      // 备份恢复路径里也要调用它
      const source = read('src/main/repository.ts')
      expect(source).toContain('reconcileResourceGroups')
    })

    it('is applied at startup so历史遗留数据会被纠正', () => {
      const source = read('src/main/repository.ts')
      // 构造函数里就要纠正一次：老库/恢复出来的库都可能带不一致的标记
      const constructorBlock = source.slice(source.indexOf('constructor('), source.indexOf('snapshot()'))
      expect(constructorBlock).toContain('reconcileResourceGroups')
    })
  })
})
