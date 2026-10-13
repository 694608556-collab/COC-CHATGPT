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
  return (
    <>
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
    </>
  )
}
const root = document.getElementById('root')!
void waitForAppFonts()
  .then(() => createRoot(root).render(<Preview />))
  .catch(() => {
    root.textContent = '内置字体加载失败，请检查开发构建的字体资源并刷新。'
  })
