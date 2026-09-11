import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  createCharacterWorkbook,
  detectCharacterSheets,
  importCharacterFromSheet,
  type CharacterField,
  type CharacterSheetPreview
} from '../shared/character-template'
import { AppError } from '../shared/errors'
import { isPathInside, nextAvailableName, sanitizeWindowsName } from '../shared/safe-path'
import { readWorkbookGrid, structureFingerprint, type WorkbookGrid } from '../shared/table-grid'
import type { ArchiveEntry, CharacterData, Edition } from '../shared/types'
import type { PdfPrinter } from './file-service'
import type { AppRepository } from './repository'

export interface CharacterImportSheet extends CharacterSheetPreview {
  cells: Array<{ address: string; value: string | number }>
}

export interface CharacterImportPreview {
  token: string
  fileName: string
  sheets: CharacterImportSheet[]
}

interface PendingImport {
  grid: WorkbookGrid
  fingerprint: string
  createdAt: number
}

export interface CharacterImportSelection {
  sheetName: string
  edition: Edition
  moduleId?: string
  mapping: Partial<Record<CharacterField, string>>
  skillHeaderRow?: number
  mappingName?: string
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function renderCharacterHtml(character: CharacterData): string {
  const skills = character.skills
    .filter((skill) => !skill.hidden)
    .map(
      (skill) =>
        `<tr><td>${escapeHtml(skill.name)}</td><td>${skill.base}</td><td>${skill.occupation}</td><td>${skill.interest}</td><td>${skill.growth}</td><td>${skill.base + skill.occupation + skill.interest + skill.growth}</td></tr>`
    )
    .join('')
  const attrs = Object.entries(character.attrs)
    .map(([name, value]) => `<div><b>${name}</b><span>${value}</span></div>`)
    .join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>@page{size:A4;margin:13mm}body{font-family:"Microsoft YaHei",sans-serif;color:#111;font-size:11px}h1{font-size:22px;margin:0 0 3mm}h2{font-size:14px;border-bottom:1px solid #777;padding-bottom:2mm}.muted{color:#555}.attrs{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm}.attrs div{display:flex;justify-content:space-between;border:1px solid #aaa;padding:2.5mm}table{width:100%;border-collapse:collapse;font-size:9px}th,td{border:1px solid #aaa;padding:1.4mm;text-align:left}.notes{white-space:pre-wrap}</style></head><body><h1>${escapeHtml(character.basic.name || '未命名调查员')}</h1><p class="muted">COC 第${character.edition === 7 ? '七' : '六'}版 · ${escapeHtml(character.basic.occupation)}</p><h2>基础属性</h2><div class="attrs">${attrs}</div><h2>当前状态</h2><p>HP ${character.derived.hpCurrent} MP ${character.derived.mpCurrent} SAN ${character.derived.sanCurrent} 幸运 ${character.edition === 6 ? character.attrs.POW * 5 : (character.derived.luck7 ?? '')} 伤害加值 ${escapeHtml(character.derived.db)}</p><h2>技能</h2><table><thead><tr><th>技能</th><th>基础</th><th>职业</th><th>兴趣</th><th>成长</th><th>合计</th></tr></thead><tbody>${skills}</tbody></table><h2>物品清单</h2><p class="notes">${escapeHtml(character.items.join('\n'))}</p><h2>调查员经历</h2><p class="notes">${escapeHtml(character.story)}</p></body></html>`
}

export class CharacterFileService {
  private readonly pending = new Map<string, PendingImport>()

  constructor(
    private readonly repository: AppRepository,
    private readonly pdfPrinter: PdfPrinter
  ) {}

  async exportCharacter(id: string, format: 'xlsx' | 'pdf'): Promise<ArchiveEntry> {
    const character = this.repository.findCharacter(id)
    const directory = this.characterDirectory(character)
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const editionName = character.edition === 7 ? '第七版' : '第六版'
    const destination = this.availableFile(
      directory,
      `${sanitizeWindowsName(character.basic.name, '未命名调查员')}${editionName}${date}.${format}`
    )
    const temporary = `${destination}.${process.pid}.tmp`
    try {
      const bytes =
        format === 'xlsx'
          ? Buffer.from(createCharacterWorkbook(character))
          : await this.pdfPrinter(renderCharacterHtml(character))
      if (format === 'pdf' && bytes.subarray(0, 4).toString() !== '%PDF') throw new Error('PDF 文件头无效')
      fs.writeFileSync(temporary, bytes)
      return this.finish(temporary, destination, character.id, format)
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
      throw new AppError('CHARACTER_EXPORT_FAILED', 'CONVERSION', '角色卡导出失败。', true, error)
    }
  }

  saveBlankTemplate(edition: Edition): ArchiveEntry {
    const directory = this.repository.getSettings().archiveDirectory
    const destination = this.availableFile(directory, `COC第${edition === 7 ? '七' : '六'}版空白角色卡.xlsx`)
    const temporary = `${destination}.${process.pid}.tmp`
    fs.writeFileSync(temporary, createCharacterWorkbook(undefined, edition))
    return this.finish(temporary, destination, `template-${edition}`, 'xlsx')
  }

  previewImport(filePath: string): CharacterImportPreview {
    const bytes = fs.readFileSync(filePath)
    const grid = readWorkbookGrid(bytes, path.basename(filePath))
    const token = randomUUID()
    const now = Date.now()
    for (const [key, value] of this.pending) if (now - value.createdAt > 30 * 60_000) this.pending.delete(key)
    this.pending.set(token, { grid, fingerprint: structureFingerprint(grid), createdAt: now })
    const detected = detectCharacterSheets(grid)
    return {
      token,
      fileName: path.basename(filePath),
      sheets: detected.map((preview) => {
        const sheet = grid.sheets.find((item) => item.name === preview.sheetName)!
        const cells = sheet.rows.flatMap((row, r) =>
          row.flatMap((value, c) =>
            typeof value === 'string' || typeof value === 'number'
              ? [{ address: this.cellAddress(r, c), value }]
              : []
          )
        )
        return { ...preview, cells }
      })
    }
  }

  commitImport(token: string, selections: CharacterImportSelection[]): CharacterData[] {
    const pending = this.pending.get(token)
    if (!pending) throw new AppError('IMPORT_EXPIRED', 'IMPORT', '导入预览已过期，请重新选择文件。')
    if (!selections.length) throw new AppError('IMPORT_EMPTY', 'VALIDATION', '请至少勾选一个工作表。')
    const created: CharacterData[] = []
    for (const selection of selections) {
      const sheet = pending.grid.sheets.find((item) => item.name === selection.sheetName)
      if (!sheet) throw new AppError('IMPORT_SHEET_MISSING', 'IMPORT', '工作表不存在。')
      const imported = importCharacterFromSheet(
        sheet,
        selection.edition,
        selection.mapping,
        selection.moduleId,
        selection.skillHeaderRow
      )
      const target = this.repository.createCharacter({
        edition: selection.edition,
        moduleId: selection.moduleId,
        name: imported.basic.name
      })
      imported.id = target.id
      imported.createdAt = target.createdAt
      created.push(this.repository.updateCharacter(target.id, imported))
      if (selection.mappingName?.trim()) {
        this.repository.saveImportMapping({
          name: selection.mappingName.trim(),
          fileType: 'excel',
          structureFingerprint: pending.fingerprint,
          fieldMappings: selection.mapping,
          createdAt: new Date().toISOString()
        })
      }
    }
    this.pending.delete(token)
    return created
  }

  private cellAddress(row: number, column: number): string {
    let current = column + 1
    let letters = ''
    while (current) {
      const remainder = (current - 1) % 26
      letters = String.fromCharCode(65 + remainder) + letters
      current = Math.floor((current - 1) / 26)
    }
    return `${letters}${row + 1}`
  }

  private characterDirectory(character: CharacterData): string {
    const root = path.resolve(this.repository.getSettings().archiveDirectory)
    const parent = character.moduleId
      ? path.join(root, sanitizeWindowsName(this.repository.findModule(character.moduleId).name), '角色卡')
      : path.join(root, '未关联角色卡')
    if (!isPathInside(root, parent)) throw new Error('角色卡归档路径不安全')
    fs.mkdirSync(parent, { recursive: true })
    return parent
  }

  private availableFile(directory: string, requestedName: string): string {
    fs.mkdirSync(directory, { recursive: true })
    const extension = path.extname(requestedName)
    const safeName = sanitizeWindowsName(requestedName.slice(0, -extension.length)) + extension
    const destination = path.join(directory, nextAvailableName(fs.readdirSync(directory), safeName))
    if (!isPathInside(directory, destination)) throw new Error('角色卡文件路径不安全')
    return destination
  }

  private finish(temporary: string, destination: string, ownerId: string, format: string): ArchiveEntry {
    const bytes = fs.readFileSync(temporary)
    if (!bytes.length) throw new Error('生成文件为空')
    fs.renameSync(temporary, destination)
    return this.repository.addArchiveEntry({
      ownerType: 'character',
      ownerId,
      path: destination,
      format,
      size: bytes.length,
      hash: createHash('sha256').update(bytes).digest('hex'),
      exists: true
    })
  }
}
