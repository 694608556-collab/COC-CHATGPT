# 安卓 1.0.0 正式 APK 构建记录

最新交付已更新为 **1.0.0 / 25**，首次欢迎页、顶部／页尾调整及新摘要见 [最新记录](FIRST-LAUNCH-1.0.0.md)。以下为首轮 **23** 的历史构建及通用签名／构建说明，首轮 APK 保留，勿将旧路径当作当前交付。

2026-10-15，基于已由 S9 用户接受的 `436dbec` / `0.2.19-dev / 22`，按用户要求制作正式签名安装包。此次授权包括新建专用正式签名，不包括自动安装、GitHub Release、PR 合并或应用商店发布。

## 安装包

- 应用名：COC 跑团记录簿。
- 正式 applicationId：`coc.logbook`；versionName：`1.0.0`；versionCode：`23`。
- 最低 Android 9 / API 28，target / compile SDK 36，网页构建目标 chrome69，原 minWebViewVersion 69 不变。
- Release build，`debuggable=false`，专用 RSA 4096 正式签名；不是重命名的调试包。
- 本机最终交付：`F:\AndroidTools\coc-logbook-releases\1.0.0-final\coc-logbook-1.0.0.apk`。
- 大小：32,157,896 字节，约 30.7 MiB。
- APK SHA-256：`f78553bd56cd166bfe7acb730028f61eb327c4b5ad60c183a5638e856b6ba659`。
- 签名证书 SHA-256：`cc3020afe7446589b5dff92eb9fe69b7593af18f614445b1d8e5805e853143e7`。
- 相邻提供 `.apk.sha256` 和公开证书 `release-certificate.pem`；APK 及密钥未加入 Git。

## 清理范围与保留项

移除应用标题中的“安卓开发版”、版本旁的“启动试验”、各页“仅保留你确认的三个模块”、设置页“开发阶段说明”和阶段验收提示。字体加载失败文案改为面向使用者的重新打开／联系制作者提醒。保留制作者、仅本机保存／联网范围说明，以及目录授权、卸载前备份、覆盖／删除确认等正常数据风险说明。

公开样本入口增加编译期开发环境门禁，在正式 JS 中移除。浏览器开发工具、样本和手势辅助仍仅存在于开发入口，以便后续开发和回归；不打入正式 APK，不删除用户自己填写的“测试”等名称。调试构建仍使用 `.debug` 包名和独立启动器名称，不能当作正式包交付。

不改原字体、按钮尺寸、全部正文、按需读取、版本检查、事务保护、排序立即保存及默认十分钟有修改才生成的自动备份规则，不恢复操作前副本或已删除功能。

## 验证结果及未验范围

- 新增 `e2e/release-ui.spec.ts`：旧版因版本／开发提示失败，修改后通过；覆盖三模块正式文案、制作者及正常风险提醒保留。
- 完整 76 项浏览器流程、58 项单元测试、TypeScript、ESLint 和格式检查通过。
- 正式网页构建、Capacitor 同步、Gradle `assembleRelease`（包括 lintVitalRelease）通过。
- `apksigner verify` 通过，签名为 v3；`zipalign -c -P 16 4` 通过。AAPT 核对正式应用名、包名、版本、minSdk 28、targetSdk 36，无 application-debuggable。
- `check-release-web.mjs` 确认正式 JS 不含开发提示、公开样本、手势辅助或源码映射，保留八份字体。
- `check-release-apk.mjs` 确认 APK 中网页与构建产物一致，八份字体逐字节等于原桌面字体，无密钥／密码／源码映射／数据库／样本文件，无开发服务器 URL，未强制启用 WebView 调试。
- 本轮未安装任何 APK，未操作手机已有应用、草稿、数据或授权；正式签名包的首次安装、目录授权、备份导入、打开／分享及其他机型适配仍待真机验证。此前 S9 测试版通过项不能直接改写为本正式签名包已通过。
- Gradle `testDebugUnitTest` 执行成功但报告 NO-SOURCE，不计为原生辅助测试重新通过；本轮没有原生存储实现变更。

## 正式签名保管

用户已明确选择新建专用正式签名。本机私有目录 `F:\AndroidTools\coc-logbook-signing` 仅允许当前 Windows 用户和 SYSTEM 访问，包含 `coc-logbook-release.p12`、`release.password` 和公开证书，别名为 `coc-logbook-release`。密码文件为本地明文，由目录 ACL 保护，未在聊天、构建日志或 Git 中输出。

**务必由用户另行做加密离线备份，保留密钥及密码；后续正式更新沿用同一签名。不要把该目录上传 GitHub、放进 APK 或随安装包分享。公司电脑若要签后续正式包，需要用户安全转移签名材料，不能另建一份冒充原签名。**

本次签名脚本修复了本机两项工具兼容：同一密码文件被 apksigner 连续消费导致 EOF，改为短时进程环境传递 key password；旧 Windows PowerShell 缺少 Get-FileHash，改用 .NET SHA256。最终完整流程成功，无私密参数明文进入命令行；首次未完成的本地构建保留在非最终目录，不作为交付文件。

## 再次构建

在 `mobile` 内，准备 JDK 21、Android SDK 36、build-tools 36.0.0，并设置 JAVA_HOME、ANDROID_HOME；先执行 `pnpm install --frozen-lockfile` 和相关回归，再调用：

```powershell
pnpm android:release -KeyStore 'X:\private\coc-logbook-release.p12' -KeyAlias coc-logbook-release -StorePasswordFile 'X:\private\release.password' -KeyPasswordFile 'X:\private\release.password' -OutputDirectory 'X:\artifacts\new-build'
```

脚本拒绝仓库内密钥／密码，拒绝覆盖已存在的同名交付 APK，构建、对齐、签名、验证及 SHA-256 生成一次完成。后续版本需同步更新 package.json、Android 版本和界面版本及相应检查，不得降低 versionCode。

正式包与 `coc.logbook.debug`、`coc.logbook.performance.debug` 是不同应用，可并存但不会自动搬运测试版私有数据库或目录授权。用户使用正式包时须重新确认普通共享文件夹；如需保留测试版数据，先在原版导出完整备份，再在正式版选择备份、预览和确认导入，不卸载原版来“迁移”。
