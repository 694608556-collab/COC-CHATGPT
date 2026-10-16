# iOS 1.0.2 / 27 接续包（2026-10-16）

[下载待签名 IPA](coc-logbook-1.0.2-ios-arm64-unsigned.ipa) · [SHA-256](coc-logbook-1.0.2-ios-arm64-unsigned.ipa.sha256)

- 包名 `coc.logbook`，版本 1.0.2 / build 27，arm64 iOS 设备包，最低声明 iOS 15；目标 iPhone 14 Pro / iOS 27.0 待真机验证。
- 大小 25,459,787 字节；SHA-256 `d3f2a210d0cbb50b696110bb7a590d7558b22627d5351f226f3f589d8adcd77a`。
- 构建源码 `7d44b6ab4cf1da9c860d1834a32a9caa9d30ca53`；[云端运行及产物](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/38878820982)，Xcode 27.0 / iOS 27.0 SDK。24 项 Swift 核心与设备 archive 成功，IPA、网页及原字体校验通过；运行中后续模拟器检查在交接时未结束，不表示整次运行成功。
- 此 IPA 未做 Apple 签名，无设备描述文件；需在自己的爱思助手中用自己的 Apple ID 或有效 iOS 证书及描述文件签名后安装，不能直接把未签名包当可安装包。凭据仅本机使用，不提交仓库；爱思对该系统的支持及实际安装未验。
- 交接源码保留新增 DEBUG 打包 Worker 检查，尚未执行，不包含于此 Release IPA。模拟器启动等待、WKWebView／WebCrypto／Worker、文件及分享流程、大数据自动备份与真实设备验收仍须接着完成，详见 [开发记录](../../IOS-DEVELOPMENT.md)。

安卓分支、旧 APK 与用户数据保留；未自动安装、卸载或清库，未合并 PR、未创建 GitHub Release。
