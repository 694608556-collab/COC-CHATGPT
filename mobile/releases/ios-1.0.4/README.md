# iPhone 1.0.4 / 29 待签名 IPA

[下载 arm64 待签名 IPA](coc-logbook-1.0.4-ios-arm64-unsigned.ipa) · [SHA-256](coc-logbook-1.0.4-ios-arm64-unsigned.ipa.sha256)

- 源码 `161706962bb77ebe021cc015aefd2c1a559ca601`，基于最新安卓优化与 1.0.4 / 29，不用旧 iOS 1.0.2 降级安卓。
- 构建：[云端运行 39113606548](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39113606548)，Xcode 27.0 / iOS 27.0 SDK 的 arm64 设备 Release。
- 包名 `coc.logbook`；版本 1.0.4，build 29；25,461,387 字节。
- SHA-256：`b2f4bc5736e120917d435b7a431d34e72961add4899ef10a04a970907552da6a`。
- 已核对 arm64 Mach-O、包名/版本、五份网页/Worker 产物逐字节匹配、八份原字体逐字节相同；未带私钥、密码、用户数据库或设备描述文件。未签名，不能直接安装。
- 同源码云端运行最终成功：78 单元、24 项 macOS 原生核心检查及 arm64 Release 构建通过；iPhone 14 Pro / iOS 27.0 连续三次冷启动均 complete，原生概览、snapshot-worker、export-worker 实际公开中文/表情正文、WebCrypto 与原字体全部通过。另有本地完整 93 浏览器回归；均不替代 iPhone 真机/系统文件选择验证。

签名和真机安装仍未验收：家用 Windows 已安装爱思助手 8.0，但未检测到已连接 iPhone；Apple ID 或有效证书及设备描述文件只能由用户在自己的爱思中配置，不发到聊天或仓库。完成签名后还需实际安装到 iPhone 14 Pro / iOS 27.0，测试首次启动、目录选择、导入导出、授权和自动备份；不把模拟器通过写成真机通过。

旧 [1.0.2 IPA](../ios-1.0.2/README.md) 和 [Android 1.0.4 APK](../1.0.4/README.md) 保留；两端原生数据库独立，跨平台备份仍经完整预览/确认/校验导入。iOS 保留原有全文/CAS/事务，不调用尚未注册的 Android 专用方法；iOS 大正文性能及实际系统文件流程仍待独立实测。未创建 GitHub Release、未合并 PR、未正式发布。

更多接续记录见 [iOS 开发说明](../../IOS-DEVELOPMENT.md)。
