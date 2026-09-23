/**
 * 场次编号的唯一真相来源，是场次名里的“第 N 场”。
 *
 * 0.6.5 及更早版本把编号（records.sequence_no）和名称各存一份：导入表格时
 * 只按表格的“场次名”改名，编号原样不动。用户把场次名重排成连续编号后，
 * 名称是 1-16、编号却还是 1-9、17-23，两者从此对不上——界面按编号判断
 * “编号缺失”，于是新增场次时弹出“选择下一场编号”，而用户看到的场次名
 * 明明是连续的。
 *
 * 0.6.6 起统一从名称推导编号：新建、改名、导入与升级迁移都走这里，
 * 名称与编号不会再各说各话。
 */

const FULL_WIDTH_DIGITS = /[０-９]/g

function toHalfWidthDigits(value: string): string {
  return value.replace(FULL_WIDTH_DIGITS, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  )
}

/**
 * 从场次名里取出“第 N 场”的 N。
 *
 * 取最后一处而不是第一处：模组名本身可能就带“第 N 场”字样，
 * 默认名“<模组名>第 10 场”拼出来时第一处是模组名里的那个号。
 *
 * 名称里没有编号（例如用户改成“决战夜”）时返回 undefined，
 * 调用方应保留该场次原有编号不动。
 */
export function sessionNumberFromName(name: string | undefined): number | undefined {
  if (!name) return undefined
  const matches = [...toHalfWidthDigits(name).matchAll(/第\s*(\d+)\s*场/g)]
  const last = matches[matches.length - 1]
  if (!last) return undefined
  const value = Number(last[1])
  return Number.isInteger(value) && value >= 1 && value <= 9999 ? value : undefined
}

/**
 * 新建场次的默认名称。写法必须始终能被 sessionNumberFromName 解析回来，
 * 否则名称与编号又会分家。
 */
export function sessionNameFor(moduleName: string, sequenceNo: number): string {
  return `${moduleName}第 ${sequenceNo} 场`
}
