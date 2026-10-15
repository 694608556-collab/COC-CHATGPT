import 'core-js/actual/object/from-entries'
import './data/compat'
import 'core-js/actual/structured-clone'
import { createRoot } from 'react-dom/client'
import { MobileApp } from './MobileApp'
import './MobileApp/styles.css'
import { waitForAppFonts } from './data/fonts'
import { Native } from './data/native'

const root = document.getElementById('root')
if (!root) throw new Error('应用入口不存在。')
// Independent startup work overlaps without showing a fallback font or skipping data validation.
const initialOverview = Native.getOverview()
void initialOverview.catch(() => {}) // MobileApp displays the original failure with an explicit retry.
void waitForAppFonts()
  .then(() => createRoot(root).render(<MobileApp initialOverview={initialOverview} />))
  .catch(() => {
    root.textContent = '内置字体加载失败，请重新打开应用或重新构建安装包。'
  })
