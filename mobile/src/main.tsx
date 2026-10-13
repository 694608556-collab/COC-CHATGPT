import 'core-js/actual/object/from-entries'
import './data/compat'
import { createRoot } from 'react-dom/client'
import { MobileApp } from './MobileApp'
import './MobileApp/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('应用入口不存在。')
createRoot(root).render(<MobileApp />)
