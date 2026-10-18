import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { ArchiveGate } from './index'

afterEach(() => vi.restoreAllMocks())

it('iOS 首次配置可显式选择本机归档，保留系统选择入口并说明卸载风险', () => {
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios')
  const html = renderToStaticMarkup(
    createElement(ArchiveGate, {
      busy: false,
      label: '尚未选择',
      onChoose: vi.fn(),
      ...{ onChooseLocal: vi.fn() }
    })
  )
  expect(html).toContain('使用本机归档文件夹')
  expect(html).toContain('选择并确认保存位置')
  expect(html).toContain('卸载应用会删除该位置')
  expect(html).not.toContain('iCloud')
})
