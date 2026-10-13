import { describe, expect, it } from 'vitest'
import { importTable } from './tables'
import { searchSample } from '../dev/sample'
describe('表格导入', () => {
  it('场次 CSV 保留现有数据、参与者和模组进度，重复链接跳过', async () => {
    const current = searchSample()
    const bytes = new TextEncoder().encode(
      '模组名,跑团状态,场次名,海豹链接,KP1,PC1,PL1\n表格测试,已完成,第一场,https://log.weizaima.com/?key=test,主持人,角色,玩家'
    )
    const first = await importTable(current, bytes, 'test.csv', 'records')
    expect(first.next.modules.at(-1)).toMatchObject({
      name: '表格测试',
      playStatus: 'finished',
      kps: ['主持人'],
      pairs: [{ pc: '角色', pl: '玩家' }]
    })
    expect(first.next.records).toHaveLength(5)
    await expect(importTable(first.next, bytes, 'test.csv', 'records')).rejects.toThrow('没有可新增')
    expect(current.records).toHaveLength(4)
  })
  it('角色表格识别姓名与属性，错误扩展名拒绝', async () => {
    const current = searchSample()
    const bytes = new TextEncoder().encode(
      '姓名,公开表格角色,职业,医生\n年龄,26,性别,女\nSTR,60,CON,55,SIZ,50,DEX,65\nAPP,50,INT,70,POW,55,EDU,75'
    )
    const result = await importTable(current, bytes, 'card.csv', 'characters')
    expect(result.next.characters[0]).toMatchObject({
      edition: 7,
      basic: { name: '公开表格角色', occupation: '医生' },
      attrs: { STR: 60, EDU: 75 }
    })
    await expect(importTable(current, bytes, 'card.exe', 'characters')).rejects.toThrow('支持')
  })
})
