/** Font files are the same verified assets as the desktop app; do not use local/system font names. */
export async function waitForAppFonts() {
  const requests = [
    ['400 15px "SF Pro Text"', 'COC 123'],
    ['500 15px "SF Pro Text"', 'COC 123'],
    ['600 15px "SF Pro Text"', 'COC 123'],
    ['400 20px "SF Pro Display"', 'COC 123'],
    ['600 20px "SF Pro Display"', 'COC 123'],
    ['400 15px "PingFang SC"', '模组场次角色卡'],
    ['500 15px "PingFang SC"', '模组场次角色卡'],
    ['700 20px "PingFang SC"', '模组场次角色卡']
  ]
  const results = await Promise.all(requests.map(([font, text]) => document.fonts.load(font!, text)))
  if (results.some((faces) => !faces.length || faces.some((face) => face.status !== 'loaded')))
    throw new Error('内置字体未加载，无法保证排版。')
}
