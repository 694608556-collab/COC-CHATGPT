import * as XLSX from 'xlsx'

/** 全部为虚构数据，独立构造模板；禁止替换为私人文件或其值。 */
export function publicCoc7Workbook(): XLSX.WorkBook {
  const cells: Record<string, string | number> = {
    B3: '姓名',
    B5: '职业',
    S3: '力量 STR',
    Y3: '敏捷 DEX',
    AE3: '意志 POW',
    F15: '技能名称',
    J15: '初始',
    L15: '成长',
    N15: '职业',
    P15: '兴趣',
    R15: '成功率 普通/困难/极限',
    AB15: '技能名称',
    AF15: '初始',
    AH15: '成长',
    AJ15: '职业',
    AL15: '兴趣',
    AN15: '成功率 普通/困难/极限',
    E3: '公开七版调查员',
    E5: '公开职业',
    E6: 28,
    M6: '女',
    E7: '公开居住地',
    M7: '公开故乡',
    U3: 60,
    U5: 55,
    U7: 50,
    AA3: 65,
    AA5: 50,
    AA7: 70,
    AG3: 55,
    AG5: 75,
    AG7: 42,
    E10: 7,
    W10: 8,
    N10: 49,
    R12: 49,
    AP52: '0',
    F16: '会计',
    J16: 14,
    R16: 14,
    F17: '取悦',
    J17: 15,
    R17: 15,
    F20: '技艺①',
    H20: '公开专长',
    J20: 5,
    N20: 10,
    R20: 15,
    F27: '克苏鲁神话',
    J27: 0,
    N27: '——',
    P27: '——',
    R27: 0,
    F34: '格斗：',
    H34: '斗殴',
    J34: 25,
    N34: 55,
    R34: 80,
    F49: '母语',
    J49: 75,
    R49: 75,
    AB17: '图书馆使用',
    AF17: 20,
    AL17: 15,
    AN17: 35,
    AB35: '侦查',
    AF35: 25,
    AH35: 5,
    AJ35: 20,
    AL35: 10,
    AN35: 60,
    AA61: '公开外貌\n第二行',
    AA63: '公开信念',
    AA65: '公开关系',
    AA67: '公开地点',
    AA69: '公开宝物',
    AA71: '公开特质',
    AA73: '公开秘密',
    AA75: '公开伤痕',
    AA77: '公开恐惧',
    W79: '公开经历首段\n' + '公开完整经历。'.repeat(200) + '\n公开经历尾段',
    F79: '公开物品甲\n完整备注',
    N79: '公开背包甲',
    F94: '公开末行物品',
    N94: '公开末行背包',
    B79: '不得导入的状态',
    D79: '不得导入的部位',
    O62: '不得导入的资产',
    Y114: '不得导入的法术',
    B53: '内置徒手不得导入',
    W53: '1D3+DB',
    B54: '公开自定义武器',
    G54: '公开类型',
    Q54: 60,
    W54: '1D6',
    AA54: '10',
    AE54: '1',
    AG54: '6',
    J50: '不得导入的职业点数9999',
    B50: '不得导入的信用范围'
  }
  const sheet: XLSX.WorkSheet = {
    '!ref': 'A1:AS117',
    '!protect': { password: 'public-fixture', selectLockedCells: true }
  }
  for (const [address, value] of Object.entries(cells))
    sheet[address] = { t: typeof value === 'number' ? 'n' : 's', v: value }
  sheet.J49 = { t: 'n', v: 75, f: 'AG5' }
  sheet.R49 = { t: 'n', v: 75, f: 'SUM(J49:P49)' }
  sheet['!merges'] = ['E3:Q3', 'E7:I7', 'M7:Q7', 'U3:V4', 'W79:AS93'].map(XLSX.utils.decode_range)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['不得导入的辅助页']]), '辅助页')
  XLSX.utils.book_append_sheet(workbook, sheet, '人物卡')
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['姓名', '不得重复导入的简化角色']]),
    '简化卡'
  )
  return workbook
}
export function publicCoc7Bytes(book = publicCoc7Workbook()): Uint8Array {
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
}
