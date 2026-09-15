// 进入 app.asar 的文件清单（electron-builder 的 build.files 以此为准）。
// 依赖包里运行时用不到的内容统一排除：类型声明、TS 源码、文档、
// 其它平台的预编译二进制、以及只有浏览器 <script> 才会用到的构建产物。
const packageFiles = [
  'out/**/*',
  'package.json',
  '!**/*.map',
  '!node_modules/**/*.d.ts',
  '!node_modules/**/*.d.cts',
  '!node_modules/**/*.d.mts',
  '!node_modules/**/*.ts',
  '!node_modules/**/*.cts',
  '!node_modules/**/*.mts',
  '!node_modules/**/*.md',
  '!node_modules/**/prebuilds/android-*/**',
  '!node_modules/**/prebuilds/ios-*/**',
  '!node_modules/**/prebuilds/darwin-*/**',
  '!node_modules/**/prebuilds/linux-*/**',
  '!node_modules/**/prebuilds/freebsd-*/**',
  '!node_modules/**/prebuilds/win32-arm64/**',
  '!node_modules/docx/dist/index.iife.js',
  '!node_modules/docx/dist/index.umd.cjs',
  '!node_modules/xlsx/formats.png',
  '!node_modules/xlsx/dist/xlsx.full.min.js',
  '!node_modules/xlsx/dist/xlsx.extendscript.js',
  '!node_modules/xlsx/dist/xlsx.core.min.js',
  '!node_modules/xlsx/dist/xlsx.mini.min.js',
  '!node_modules/xlsx/dist/cpexcel.full.mjs',
  '!node_modules/xlsx/dist/xlsx.zahl.js',
  '!node_modules/xlsx/dist/xlsx.zahl.mjs'
]

const excludePatterns = packageFiles
  .filter((pattern) => pattern.startsWith('!'))
  .map((pattern) => pattern.slice(1))

module.exports = { packageFiles, excludePatterns }
