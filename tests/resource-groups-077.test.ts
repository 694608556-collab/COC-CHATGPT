// 0.7.7：把 A 分组的资料全部拖走后，A 分组条目必须还在（只是空的）
//
// 用户反馈（严重）：「新增了一个 A 模组条目，然后将 A 模组条目中的资料全部
// 拖拽入未归属模组后，A 模组条目直接消失」。
//
// 真实数据定位到的根因（用用户的 coc.sqlite 复现）：
//   settings 里同时存在两个字段
//     hiddenResourceGroups  = ["d7af92ff-…"]   ← 0.7.1 起用的新字段
//     hiddenResourceModules = ["d7af92ff-…"]   ← 0.7.0 的旧字段，从未被清理
//   getSettings() 读取时把旧字段合并进新字段（为了兼容升级），但
//   reconcileResourceGroups() 只更新新字段 —— 旧字段里的条目下次读取
//   又被合并回来，于是「有资料的分组」永远清不掉「已移除」标记。
//   那个分组只是靠「有资料就显示」这条例外规则在显示，资料一被拖空，
//   例外失效，分组立刻消失。
//
// 修法：合并旧字段后立刻把它清空，让数据收敛；reconcile 也一并处理旧字段。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import { AppRepository } from '../src/main/repository'
import { UNASSIGNED_GROUP } from '../src/shared/types'

/** 建一个干净的库，返回 id */
function makeRepository(): { repo: AppRepository; file: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-groups-077-'))
  const file = path.join(dir, 'coc.sqlite')
  const database = new AppDatabase(file)
  database.initialize()
  database.close()
  return { repo: new AppRepository(new AppDatabase(file), dir), file, dir }
}

/**
 * 删掉临时目录。
 *
 * Windows 上 SQLite 文件在连接关闭前一直被占用，直接 rmSync 会 EPERM。
 * 这里忽略删除失败：断言已经跑完，残留的临时目录由系统清理，
 * 不该因此把测试判成失败（那会把「功能对不对」和「能不能删文件」混在一起）。
 */
function cleanup(dir: string): void {
  try {
    cleanup(dir)
  } catch {
    // 文件仍被占用，交给系统临时目录清理
  }
}

/** 直接把 settings 写成「两个字段都有值」的历史状态 */
function writeLegacySettings(
  file: string,
  groups: string[],
  legacy: string[],
  repo: AppRepository
): void {
  repo.updateSettings({ hiddenResourceGroups: groups })
  const raw = new DatabaseSync(file)
  const row = raw.prepare('SELECT data_json FROM settings WHERE id = 1').get() as { data_json: string }
  const settings = JSON.parse(row.data_json)
  settings.hiddenResourceGroups = groups
  settings.hiddenResourceModules = legacy
  raw.prepare('UPDATE settings SET data_json = ? WHERE id = 1').run(JSON.stringify(settings))
  raw.close()
}

/** 分组在界面上是否可见：hidden 只对空分组生效，有资料就一定显示 */
function groupVisible(repo: AppRepository, moduleId: string): boolean {
  const hidden = new Set(repo.getSettings().hiddenResourceGroups ?? [])
  const count = repo.listResources().filter((resource) => resource.moduleId === moduleId).length
  return !hidden.has(moduleId) || count > 0
}

describe('0.7.7 emptying a group keeps the group', () => {
  it('keeps the group after its last resource is dragged to another module', () => {
    const { repo, dir } = makeRepository()
    const a = repo.createModule({ name: 'A模组', playStatus: 'running' })
    const b = repo.createModule({ name: 'B模组', playStatus: 'running' })
    const r1 = repo.createResource({ moduleId: a.id, kind: 'file', title: 'A一', path: 'F:\\1\\a1.pdf' })
    const r2 = repo.createResource({ moduleId: a.id, kind: 'file', title: 'A二', path: 'F:\\1\\a2.pdf' })

    expect(groupVisible(repo, a.id)).toBe(true)
    repo.setResourceModule(r1.id, b.id)
    repo.setResourceModule(r2.id, b.id)

    expect(repo.listResources().filter((r) => r.moduleId === a.id)).toHaveLength(0)
    expect(groupVisible(repo, a.id), 'A 分组拖空后必须还在').toBe(true)
    expect(repo.getSettings().hiddenResourceGroups ?? []).not.toContain(a.id)
    cleanup(dir)
  })

  it('keeps the group after its last resource is dragged to the unassigned group', () => {
    // 用户的确切操作路径：全部拖入【未归属模组】
    const { repo, dir } = makeRepository()
    const a = repo.createModule({ name: 'A模组', playStatus: 'running' })
    const r1 = repo.createResource({ moduleId: a.id, kind: 'file', title: 'A一', path: 'F:\\1\\a1.pdf' })
    const r2 = repo.createResource({ moduleId: a.id, kind: 'file', title: 'A二', path: 'F:\\1\\a2.pdf' })

    repo.setResourceModule(r1.id, undefined)
    repo.setResourceModule(r2.id, undefined)

    expect(repo.listResources().filter((r) => r.moduleId === a.id)).toHaveLength(0)
    expect(groupVisible(repo, a.id), 'A 分组拖空后必须还在').toBe(true)
    cleanup(dir)
  })

  it('clears a stale mark left by the 0.7.0 field on startup', () => {
    // 核心回归：旧字段 hiddenResourceModules 里留着标记、分组却还有资料。
    // 修复前这个标记永远清不掉，分组一拖空就消失。
    const { repo, file, dir } = makeRepository()
    const a = repo.createModule({ name: 'A模组', playStatus: 'running' })
    const r1 = repo.createResource({ moduleId: a.id, kind: 'file', title: 'A一', path: 'F:\\1\\a1.pdf' })
    writeLegacySettings(file, [a.id], [a.id], repo)

    // 重启（重新构造 repository）
    const restarted = new AppRepository(new AppDatabase(file), dir)
    expect(
      restarted.getSettings().hiddenResourceGroups ?? [],
      '有资料的旧标记应在启动时被清掉'
    ).not.toContain(a.id)

    // 旧字段也必须被清空，否则下次读取又会合并回来
    const raw = new DatabaseSync(file)
    const row = raw.prepare('SELECT data_json FROM settings WHERE id = 1').get() as { data_json: string }
    const stored = JSON.parse(row.data_json)
    raw.close()
    expect(stored.hiddenResourceModules ?? [], '旧字段应被清空').toEqual([])

    // 现在把它拖空，分组仍然要在
    restarted.setResourceModule(r1.id, undefined)
    expect(groupVisible(restarted, a.id), '拖空后 A 分组必须还在').toBe(true)
    cleanup(dir)
  })

  it('still lets the user delete a group on purpose', () => {
    // 修复不能过头：用户明确删掉的分组必须真的不再显示，
    // 否则「删不掉」会是新的 bug
    const { repo, file, dir } = makeRepository()
    const a = repo.createModule({ name: 'A模组', playStatus: 'running' })
    // 空分组 → 允许标记为已移除
    repo.hideResourceGroup(a.id)
    expect(groupVisible(repo, a.id), '空分组被删后不该显示').toBe(false)

    const restarted = new AppRepository(new AppDatabase(file), dir)
    expect(groupVisible(restarted, a.id), '重启后仍不该显示').toBe(false)
    cleanup(dir)
  })

  it('refuses to mark a group that still has resources', () => {
    // 从源头拒绝：有资料的分组不能被标记为已移除，
    // 否则它只是「靠例外显示」，资料一拖走就消失
    const { repo, dir } = makeRepository()
    const a = repo.createModule({ name: 'A模组', playStatus: 'running' })
    repo.createResource({ moduleId: a.id, kind: 'file', title: 'A一', path: 'F:\\1\\a1.pdf' })

    repo.hideResourceGroup(a.id)
    expect(repo.getSettings().hiddenResourceGroups ?? []).not.toContain(a.id)
    cleanup(dir)
  })

  it('keeps the unassigned group visible while it still holds resources', () => {
    const { repo, dir } = makeRepository()
    const a = repo.createModule({ name: 'A模组', playStatus: 'running' })
    const r1 = repo.createResource({ moduleId: a.id, kind: 'file', title: 'A一', path: 'F:\\1\\a1.pdf' })
    repo.setResourceModule(r1.id, undefined)

    // 未归属分组现在有资料，标记必须是空的
    expect(repo.getSettings().hiddenResourceGroups ?? []).not.toContain(UNASSIGNED_GROUP)
    cleanup(dir)
  })

  it('drops marks that point at modules which no longer exist', () => {
    const { repo, file, dir } = makeRepository()
    const a = repo.createModule({ name: 'A模组', playStatus: 'running' })
    writeLegacySettings(file, ['已经不存在的模组id'], [], repo)

    const restarted = new AppRepository(new AppDatabase(file), dir)
    expect(restarted.getSettings().hiddenResourceGroups ?? []).toEqual([])
    void a
    cleanup(dir)
  })

  it('survives a restart with the group still visible', () => {
    const { repo, file, dir } = makeRepository()
    const a = repo.createModule({ name: 'A模组', playStatus: 'running' })
    const r1 = repo.createResource({ moduleId: a.id, kind: 'file', title: 'A一', path: 'F:\\1\\a1.pdf' })
    repo.setResourceModule(r1.id, undefined)

    const restarted = new AppRepository(new AppDatabase(file), dir)
    expect(groupVisible(restarted, a.id), '重启后 A 分组仍应显示').toBe(true)
    cleanup(dir)
  })

  it('repairs the exact state found in the reported database', () => {
    // 用户真实库（coc.sqlite）里的状态，逐字段复刻：
    //   settings.hiddenResourceGroups  = [模组 id]
    //   settings.hiddenResourceModules = [同一个模组 id]   ← 0.7.0 的旧字段
    //   该模组名下还有 1 条资料，另有 4 条未归属资料
    // 修复前：两个字段都没被清理，分组靠「有资料」显示，一拖空就消失。
    const { repo, file, dir } = makeRepository()
    const group = repo.createModule({ name: '铸形骸，灯心性，启天命', playStatus: 'running' })
    const kept = repo.createResource({
      moduleId: group.id,
      kind: 'link',
      title: '',
      url: 'https://example.com'
    })
    for (let i = 0; i < 4; i += 1) {
      repo.createResource({ kind: 'mindmap', title: '世界回归进行曲', path: `F:\\1\\m${i}.emmx` })
    }
    writeLegacySettings(file, [group.id], [group.id], repo)

    const restarted = new AppRepository(new AppDatabase(file), dir)
    const hidden = restarted.getSettings().hiddenResourceGroups ?? []
    console.log(`修复后 hidden = ${JSON.stringify(hidden)}`)
    expect(hidden, '有资料的旧标记应在启动时被清掉').not.toContain(group.id)

    // 把最后一条资料拖到未归属 —— 用户的确切操作
    restarted.setResourceModule(kept.id, undefined)
    const left = restarted.listResources().filter((r) => r.moduleId === group.id).length
    console.log(`拖空后: 剩余=${left} 分组可见=${groupVisible(restarted, group.id)}`)
    expect(left).toBe(0)
    expect(groupVisible(restarted, group.id), '拖空后分组必须还在').toBe(true)

    // 未归属分组此时有 5 条资料，也必须显示
    expect(
      restarted.getSettings().hiddenResourceGroups ?? [],
      '未归属分组有资料时不该被标记'
    ).not.toContain(UNASSIGNED_GROUP)
    cleanup(dir)
  })
})
