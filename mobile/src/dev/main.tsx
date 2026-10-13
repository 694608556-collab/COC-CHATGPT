import 'core-js/actual/object/from-entries'
import '../data/compat'
import 'core-js/actual/structured-clone'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MobileApp } from '../MobileApp'
import { createBrowserPort } from './browser-port'
import type { BrowserDocument } from './browser-port'
import { searchSample } from './sample'
import { decodeBase64 } from '../data/native'
import '../MobileApp/styles.css'
import { waitForAppFonts } from '../data/fonts'
import { GestureTestingContext } from '../MobileApp/components/GestureTestingContext'
import type { GestureTestSource } from '../MobileApp/components/GestureTestingContext'

const browser = createBrowserPort()
function download(name: string, bytes: Uint8Array, mime: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function Preview() {
  const [files, setFiles] = useState<BrowserDocument[]>([])
  const [error, setError] = useState('')
  const [gestureHelp, setGestureHelp] = useState(true)
  const [gestureSource, setGestureSource] = useState<GestureTestSource>()
  return (
    <GestureTestingContext.Provider
      value={{
        enabled: gestureHelp,
        source: gestureSource,
        start: setGestureSource,
        cancel: () => setGestureSource(undefined)
      }}
    >
      <aside className="dev-banner">
        <strong>浏览器开发预览</strong>
        <p>
          仅使用当前浏览器测试数据。目录授权、SQLite、系统返回键和旧 WebView
          兼容性需在安卓验收。测试文件保存于浏览器，需下载才能留在电脑上。
        </p>
        <button
          onClick={() =>
            download(
              'coc-search-sample.json',
              new TextEncoder().encode(JSON.stringify(searchSample())),
              'application/json'
            )
          }
        >
          下载公开测试样本
        </button>
        <button
          onClick={() => {
            void browser
              .documents()
              .then(setFiles)
              .catch((e) => setError(String(e)))
          }}
        >
          刷新测试文件列表
        </button>
        <button onClick={() => window.dispatchEvent(new Event('logbook-back'))}>测试系统返回键</button>
        <label className="check">
          <input
            type="checkbox"
            checked={gestureHelp}
            onChange={(event) => {
              setGestureHelp(event.target.checked)
              setGestureSource(undefined)
            }}
          />
          显示鼠标手势辅助
        </label>
        <details className="gesture-instructions">
          <summary>鼠标操作说明</summary>
          <p>
            鼠标：左键按住约半秒，看到紫色边框后松开可多选，继续上下拖动可排序；按住左键向左拖动可露出删除。
          </p>
          <p>
            辅助按钮仅用于浏览器预览：模拟长按进入多选，模拟左滑露出删除，模拟拖动后点击同一列表中的目标位置。
          </p>
        </details>
        {gestureSource && (
          <p role="status">
            正在模拟拖动“{gestureSource.label}”：点击同一列表中的目标项。
            <button onClick={() => setGestureSource(undefined)}>取消模拟拖动</button>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {!!files.length && (
          <details>
            <summary>测试文件（{files.length}）</summary>
            {files.map((file) => (
              <button
                key={file.uri}
                onClick={() => download(file.name, decodeBase64(file.base64), file.mime)}
              >
                {file.name}
              </button>
            ))}
          </details>
        )}
      </aside>
      <MobileApp
        port={browser.port}
        testBackup={() => new TextEncoder().encode(JSON.stringify(searchSample()))}
      />
    </GestureTestingContext.Provider>
  )
}
const root = document.getElementById('root')!
void waitForAppFonts()
  .then(() => createRoot(root).render(<Preview />))
  .catch(() => {
    root.textContent = '内置字体加载失败，请检查开发构建的字体资源并刷新。'
  })
