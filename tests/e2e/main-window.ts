import type { ElectronApplication, Page } from '@playwright/test'

/** @param app 隔离测试应用。@returns 开屏结束后的业务窗口，超时抛错。 */
export async function mainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const page = app.windows().find((item) => !item.isClosed() && item.url().includes('/renderer/index.html'))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('主窗口未在45秒内打开')
}
