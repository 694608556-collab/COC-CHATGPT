import { expect, it, vi } from 'vitest'
import { cancelImportFromBack } from '../../tests/public-io-navigation'

it('iOS cancellation dispatches the real navigation event and invokes its listener without requiring Android markup', () => {
  const target = new EventTarget(), handler = vi.fn(), querySelector = vi.fn()
  target.addEventListener('logbook-back', handler)
  cancelImportFromBack('ios', { querySelector }, target)
  expect(handler).toHaveBeenCalledOnce()
  expect(handler.mock.calls[0]![0].type).toBe('logbook-back')
  expect(querySelector).not.toHaveBeenCalled()
})

it('Android cancellation clicks its actual button and fails when that control is missing', () => {
  const click = vi.fn(), dispatchEvent = vi.fn()
  const querySelector = vi.fn(() => ({ click })) as unknown as Document['querySelector']
  cancelImportFromBack('android', { querySelector }, { dispatchEvent })
  expect(querySelector).toHaveBeenCalledExactlyOnceWith('.app-back')
  expect(click).toHaveBeenCalledOnce()
  expect(dispatchEvent).not.toHaveBeenCalled()
  expect(() => cancelImportFromBack('android', { querySelector: () => null }, { dispatchEvent })).toThrow('back button is missing')
})
