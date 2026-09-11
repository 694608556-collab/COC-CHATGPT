# ADR-0001：桌面容器、本地存储与离线文档

状态：采纳

## 决策

1. 使用 Electron 38.8.6、React、TypeScript 和 Vite 构建 Windows x64 免安装桌面应用。
2. 使用 Electron 随附 Node 22 的 `node:sqlite`，数据库位于便携程序同级 `data` 目录，不使用需要本机编译的 SQLite 扩展。
3. 渲染进程启用上下文隔离、禁用 Node 集成并启用沙箱；本地文件和数据库只通过带校验的 preload IPC 使用。
4. TXT、DOCX 和 PDF 均从应用标准化数据本地生成。PDF 使用隐藏打印页，DOCX 使用 OOXML 库，不捆绑 LibreOffice。
5. 在线海豹协议封装在单一适配器内，测试主要使用脱敏固定固件。

## 原因

- 免安装包不能要求用户安装 Node、Python、数据库、Word 或转换器。
- Electron 自带 SQLite 避免原生扩展 ABI 和编译工具链问题。
- 本地生成文档体积更小，也避免 Office 子进程、配置锁和可执行命令面的额外风险。

## 验证证据

- Electron 运行时、应用入口及 portable EXE 均在 Windows 10 x64（10.0.19045）正常完成隐藏冒烟测试。
- portable EXE 把数据写入 EXE 同级 `data`，不是临时解压目录。
- 连续 20 次中文 PDF 生成通过。
- 当前单元测试覆盖 URL、状态分类、8 项过滤、XLS/XLSX/CSV、DOCX、路径与便携数据目录。

## 开发工具沙箱说明

Electron 在开发工具的受限命令沙箱内初始化 Chromium 会触发访问异常；在正常桌面权限下状态为 0。该限制只影响自动化工具如何启动 GUI，不是最终用户环境依赖，也不影响打包产物。
