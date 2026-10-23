/** Invoke the platform's existing production back entry point. iOS uses the
 * same event as its native navigation gesture; Android renders a back button. */
export function cancelImportFromBack(platform: string, page: Pick<Document, 'querySelector'>, target: Pick<Window, 'dispatchEvent'>) {
  if (platform === 'ios') {
    target.dispatchEvent(new Event('logbook-back'))
    return
  }
  const button = page.querySelector<HTMLButtonElement>('.app-back')
  if (!button) throw new Error('Actual Android back button is missing')
  button.click()
}
