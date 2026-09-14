import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import App from './App'
import sfDisplayRegular from './assets/fonts/SF-Pro-Display-Regular.otf?url'
import sfDisplaySemibold from './assets/fonts/SF-Pro-Display-Semibold.otf?url'
import sfTextRegular from './assets/fonts/SF-Pro-Text-Regular.otf?url'
import sfTextMedium from './assets/fonts/SF-Pro-Text-Medium.otf?url'
import sfTextSemibold from './assets/fonts/SF-Pro-Text-Semibold.otf?url'
import pingFangRegular from './assets/fonts/PingFangSC-Regular.ttf?url'
import pingFangMedium from './assets/fonts/PingFangSC-Medium.ttf?url'
import pingFangBold from './assets/fonts/PingFangSC-Bold.ttf?url'

const fontStyle = document.createElement('style')
fontStyle.dataset.cocFonts = 'embedded'
fontStyle.textContent = `
@font-face { font-family: "SF Pro Display";
  src: url("${sfDisplayRegular}"); font-weight: 400; }
@font-face { font-family: "SF Pro Display";
  src: url("${sfDisplaySemibold}"); font-weight: 600; }
@font-face { font-family: "SF Pro Text";
  src: url("${sfTextRegular}"); font-weight: 400; }
@font-face { font-family: "SF Pro Text";
  src: url("${sfTextMedium}"); font-weight: 500; }
@font-face { font-family: "SF Pro Text";
  src: url("${sfTextSemibold}"); font-weight: 600; }
@font-face { font-family: "PingFang SC";
  src: url("${pingFangRegular}"); font-weight: 400; }
@font-face { font-family: "PingFang SC";
  src: url("${pingFangMedium}"); font-weight: 500; }
@font-face { font-family: "PingFang SC";
  src: url("${pingFangBold}"); font-weight: 700; }
`
document.head.append(fontStyle)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
