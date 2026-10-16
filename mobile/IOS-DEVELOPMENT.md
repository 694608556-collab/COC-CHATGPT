# iPhone / IPA 独立分支

- 分支：`codex/ios-ipa-adaptation`，从已交付 Android 1.0.2 / 27 的 `ca58838` 创建。安卓分支、APK、用户浏览器数据与本机签名材料保留；此分支不合入安卓、不创建 GitHub Release。
- 用户目标：iPhone 14 Pro / iOS 27.0。框架为 Capacitor iOS 8.5.3，独立 Xcode / Swift 工程，最低声明 iOS 15；目标设备实际兼容性仍待测试。
- 三模块、字体、完整正文与桌面文件命名继续复用。Swift 原生桥接实现私有 SQLite、概览／按需正文、小设置／实体／排序提交、CAS／事务回滚、文件选择与安全作用域书签、重名新建／回读摘要、打开／分享及自动备份独立文件队列。
- iOS SQLite 采用独立版本 1 的元数据／正文分离结构，不打开或自动迁移安卓私有数据库。安卓备份 JSON／ZIP 可经原预览、确认与完整校验导入；备份保留既有 `coc.logbook.android` 格式标识以兼容现有安卓，不表示运行平台仍是安卓。
- iOS 不注册安卓返回键和最小化接口；安全区使用 iOS 专用 `viewport-fit=cover` 与原生 WKWebView，安卓入口仍为 contain。iOS 通过系统文件 App 选本机目录，数据库留在私有 Application Support，导出可见于文件 App。

## 编译与签名

Windows 可运行 `pnpm install --frozen-lockfile`、`pnpm ios:sync` 与浏览器预览；完整 iOS 编译在 macOS / Xcode，工作流 `iOS IPA development` 使用 `xcode-27`。先检查 Swift 核心事务／正文／重名保护，再编译 `generic/platform=iOS` 的 arm64 Release，打成 `Payload/App.app` IPA，核对包名、版本、架构、网页及原字体。

**当前产物目标为待签名 IPA**：没有索取或上传 Apple ID、iOS 证书或设备描述文件，不用安卓证书冒充 iOS 签名。需在自己的爱思助手中用自己的 Apple ID 或有效 iOS 证书及描述文件签名，再安装；未签名 IPA 不能直接安装。账号密码只在用户自己的电脑操作，不提交到仓库。爱思具体版本对 iOS 27 的安装支持及目标机首次启动还需用户确认。

## 当前进度与边界

已生成 iOS 工程并完成桥接初版；Windows 侧 63 项移动单元、类型、iOS 网页／资源同步及生产资源检查通过。Swift 原生编译及核心检查以工作流实际结果为准，尚未把未执行项目写成通过。本文后续继续记录编译错误修复、IPA、构建和摘要。

系统目录选择、持久书签在设备重启／授权失效后的行为、第三方文件提供者、系统分享、iOS 键盘与安全区、冷启动及自动备份大数据等待均须原生环境和用户真机复测。自动备份仅应用运行时按原十分钟／有修改规则执行，不承诺 iOS 后台定时。没有卸载、清库、操作前副本或真机通过结论。

官方依据：[Capacitor iOS](https://capacitorjs.com/docs/ios)、[Swift 插件](https://capacitorjs.com/docs/plugins/ios)、[GitHub Xcode 27 环境](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md)、[爱思 IPA 签名说明](https://helper.i4.cn/news_detail_38195.html)。
