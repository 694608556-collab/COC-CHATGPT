import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** @param page - 独立测试页面。 @returns 安装公开确认卡片的自动确认操作后 resolve，无返回值；取消专项须移除此处理器。 */
export async function acceptAppConfirmations(page: Page) {
  await page.addLocatorHandler(
    page.getByRole('dialog', { name: '确认操作', exact: true }),
    async (dialog) => {
      await dialog.getByRole('button', { name: '确认', exact: true }).click()
    }
  )
}

export async function expandModules(page: Page) {
  await expect(page.locator('[data-module-toggle]').first()).toBeVisible()
  const collapsed = page.locator('[data-module-toggle][aria-expanded="false"]')
  while (await collapsed.count()) await collapsed.first().click()
}

export async function swipeLeft(page: Page, row: Locator) {
  await row.scrollIntoViewIfNeeded()
  const box = (await row.boundingBox())!
  const x = box.x + box.width * 0.65
  const y = box.y + Math.min(box.height / 2, 25)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 90, y, { steps: 8 })
  await page.mouse.up()
  await expect(row.locator('.swipe-delete')).toBeVisible()
}
