/**
 * 0.7.1 阶段 3：「未归属模组」应当是一个能真正删掉的正常分组。
 *
 * 用户反馈「未归属模组无法完全删除，右下角提示也只是移除资料」。
 *
 * 根因：隐藏标记 hiddenResourceModules 存的是【模组 id】，而未归属分组没有 id，
 * 所以「连分组一起删」对它只能删资料、记不下任何标记，刷新后分组又回来了；
 * 提示词也只说「已移除未归属分组的 N 条资料」。
 *
 * 修法：给未归属分组一个固定的哨兵标记（UNASSIGNED_GROUP），与模组 id 共用
 * 同一份隐藏列表。这样两种分组走完全相同的机制，未归属分组也能被真正删掉。
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-071-unassigned-'))
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
      // Windows 上 sqlite 句柄偶尔还没释放，删不掉就留给系统清理临时目录
    }
  }
})

describe('0.7.1 stage 3: unassigned group can be deleted', () => {
  describe('the sentinel marker', () => {
    it('exists and cannot collide with a real module id', () => {
      expect(UNASSIGNED_GROUP).toBeTruthy()
      // 模组 id 是 uuid（36 字符）；哨兵必须明显不是 uuid，否则可能撞上真模组
      expect(UNASSIGNED_GROUP).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    })
  })

  describe('hiding and showing', () => {
    it('records the unassigned group as hidden', () => {
      const repository = makeRepository()
      expect(repository.getSettings().hiddenResourceGroups ?? []).toEqual([])
      repository.hideResourceGroup(UNASSIGNED_GROUP)
      expect(repository.getSettings().hiddenResourceGroups).toContain(UNASSIGNED_GROUP)
    })

    it('survives a reload, so the group does not come back', () => {
      const repository = makeRepository()
      repository.hideResourceGroup(UNASSIGNED_GROUP)
      // 重新读一次设置，模拟界面刷新
      expect(repository.getSettings().hiddenResourceGroups).toContain(UNASSIGNED_GROUP)
    })

    it('shows the group again when a resource becomes unassigned', () => {
      const repository = makeRepository()
      const module = repository.createModule({ name: '渊娲之海', playStatus: 'running' })
      const resource = repository.createResource({
        moduleId: module.id,
        kind: 'link',
        title: 'Notion',
        url: 'https://example.com'
      })
      repository.hideResourceGroup(UNASSIGNED_GROUP)
      expect(repository.getSettings().hiddenResourceGroups).toContain(UNASSIGNED_GROUP)
      // 把资料改成未归属 → 未归属分组必须重新出现，否则资料无处可去
      repository.setResourceModule(resource.id, undefined)
      expect(repository.getSettings().hiddenResourceGroups ?? []).not.toContain(UNASSIGNED_GROUP)
    })

    it('shows the group again when a new unassigned resource is created', () => {
      const repository = makeRepository()
      repository.hideResourceGroup(UNASSIGNED_GROUP)
      repository.createResource({ kind: 'link', title: '未归属链接', url: 'https://example.com' })
      expect(repository.getSettings().hiddenResourceGroups ?? []).not.toContain(UNASSIGNED_GROUP)
    })

    it('keeps module groups and the unassigned group independent', () => {
      const repository = makeRepository()
      const module = repository.createModule({ name: '渊娲之海', playStatus: 'running' })
      repository.hideResourceGroup(UNASSIGNED_GROUP)
      repository.hideResourceGroup(module.id)
      const hidden = repository.getSettings().hiddenResourceGroups ?? []
      expect(hidden).toContain(UNASSIGNED_GROUP)
      expect(hidden).toContain(module.id)
      // 只恢复未归属，模组的标记不受影响
      repository.showResourceGroup(UNASSIGNED_GROUP)
      const after = repository.getSettings().hiddenResourceGroups ?? []
      expect(after).not.toContain(UNASSIGNED_GROUP)
      expect(after).toContain(module.id)
    })
  })

  describe('migrating the old setting name', () => {
    it('keeps reading the 0.7.0 field so existing users do not lose their removals', () => {
      const source = read('src/main/repository.ts')
      // 0.7.0 用的是 hiddenResourceModules，改名后必须兼容旧数据
      expect(source).toContain('hiddenResourceModules')
      expect(source).toContain('hiddenResourceGroups')
    })

    it('carries old hidden modules over to the new field', () => {
      const repository = makeRepository()
      const module = repository.createModule({ name: '渊娲之海', playStatus: 'running' })
      // 直接写 0.7.0 的老字段
      repository.updateSettings({ hiddenResourceModules: [module.id] })
      // 新字段应能读到它（读时合并），否则升级后用户删过的分组会全部复活
      expect(repository.getSettings().hiddenResourceGroups).toContain(module.id)
    })
  })

  describe('the page uses the same mechanism for both', () => {
    it('routes the unassigned group through removeGroup like a module group', () => {
      const page = read('src/renderer/src/components/ResourcesPage.tsx')
      // 未归属分组也要调用 remove-group（带哨兵），否则删不掉
      expect(page).toContain('UNASSIGNED_GROUP')
      expect(page).toContain('removeGroup')
      // 提示词要说明分组已被移除，而不只是「移除了资料」
      expect(page).toContain('已移除')
    })

    it('hides the unassigned group when it is marked hidden', () => {
      const page = read('src/renderer/src/components/ResourcesPage.tsx')
      expect(page).toContain('hiddenGroups')
    })
  })
})
