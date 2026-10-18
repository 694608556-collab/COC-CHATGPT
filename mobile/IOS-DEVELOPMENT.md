# iPhone / IPA 独立分支

## 2026-10-18 接续：以最新安卓优化及 1.0.4 / 29 为基线

已保留原 `01475f49` 及旧 1.0.2 待签名 IPA。接入 Android 优化源码 f36be68 和 1.0.4 构建提交 2b50fc6；安卓 APK 独立位于 [1.0.4](releases/1.0.4/README.md)，不从旧 iOS 分支降级安卓。iOS 工程与打包校验同步 1.0.4 / 29，但设备包仍须 macOS 云端构建，不假称 Windows 可以执行 Xcode。

旧云端运行 38878820982 最终为失败：设备构建/IPA 上传成功，iPhone 14 Pro / iOS 27.0 模拟器已启动并安装，但 WKWebView 检查仅报 JavaScript 异常；不是卡在编译，也不是启动已通过。现在固定要求 27.0 运行时、给全部子进程设置超时，DEBUG 原生检查输出具体阶段、错误/堆栈和 WebCrypto 可用性，并实际运行打包 snapshot-worker 与 export-worker 公开正文任务。新云端结果待回填。

最新 Android 专用私有读取、分段编辑、文字 PDF 及导出暂存接口只在 Android 调用；iOS 保留既有完整读取/事务写入、完整浏览器 PDF 生成及原生新建回读保存，不能因 Capacitor.isNativePlatform 为真就调用未注册的 Android 方法。保留 iOS 安全区、前后台监听与原生书签；根页面不调用 iOS 不支持的 minimizeApp。原字体、正文、CAS、事务、十分钟有修改才自动备份不变；没有迁移/打开安卓私有数据库。

iOS 大正文性能与原生文件流程仍须独立验收，不能继承 S9 通过结论。家用 Windows 检测到爱思助手 8.0，当前未检测到已连接 iPhone；签名/安装等待用户连接并在自己的爱思界面配置 Apple ID 或有效证书，不索取聊天中的账号密码，不伪造真机通过，不发布或合并 PR。

以下为原交接记录，旧版本/待验状态按时间阅读。


- 分支：`codex/ios-ipa-adaptation`，从已交付 Android 1.0.2 / 27 的 `ca58838` 创建。安卓分支、APK、用户浏览器数据与本机签名材料保留；此分支不合入安卓、不创建 GitHub Release。
- 用户目标：iPhone 14 Pro / iOS 27.0。框架为 Capacitor iOS 8.5.3，独立 Xcode / Swift 工程，最低声明 iOS 15；目标设备实际兼容性仍待测试。
- 三模块、字体、完整正文与桌面文件命名继续复用。Swift 原生桥接实现私有 SQLite、概览／按需正文、小设置／实体／排序提交、CAS／事务回滚、文件选择与安全作用域书签、重名新建／回读摘要、打开／分享及自动备份独立文件队列。
- iOS SQLite 采用独立版本 1 的元数据／正文分离结构，不打开或自动迁移安卓私有数据库。安卓备份 JSON／ZIP 可经原预览、确认与完整校验导入；备份保留既有 `coc.logbook.android` 格式标识以兼容现有安卓，不表示运行平台仍是安卓。
- iOS 不注册安卓返回键和最小化接口；安全区使用 iOS 专用 `viewport-fit=cover` 与原生 WKWebView，安卓入口仍为 contain。iOS 通过系统文件 App 选本机目录，数据库留在私有 Application Support，导出可见于文件 App。

## 编译与签名

Windows 可运行 `pnpm install --frozen-lockfile`、`pnpm ios:sync` 与浏览器预览；完整 iOS 编译在 macOS / Xcode，工作流 `iOS IPA development` 使用 `xcode-27`。先检查 Swift 核心事务／正文／重名保护，再编译 `generic/platform=iOS` 的 arm64 Release，打成 `Payload/App.app` IPA，核对包名、版本、架构、网页及原字体。

**当前产物目标为待签名 IPA**：没有索取或上传 Apple ID、iOS 证书或设备描述文件，不用安卓证书冒充 iOS 签名。需在自己的爱思助手中用自己的 Apple ID 或有效 iOS 证书及描述文件签名，再安装；未签名 IPA 不能直接安装。账号密码只在用户自己的电脑操作，不提交到仓库。爱思具体版本对 iOS 27 的安装支持及目标机首次启动还需用户确认。

## 当前进度与边界

截至 2026-10-16 接续快照：63 项移动单元、类型、iOS 网页／资源同步及生产资源检查通过，8 项既有 Edge 浏览器流程通过；macOS 上 24 项 Swift 核心检查通过，覆盖正文、CAS、事务失败回滚、角色与模组 PC 独立、重名及备份文件保护。Xcode 27.0 / iOS 27.0 SDK 已成功编译 arm64 设备 Release 并生成待签名 IPA，包内网页、八份原字体、设备架构与无私有签名／数据库检查通过。下载及摘要见 [IPA 接续包](releases/ios-1.0.2/README.md)。

构建源码为 `7d44b6ab4cf1da9c860d1834a32a9caa9d30ca53`，[云端第 4 次运行](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/38878820982) 的原生核心、设备编译及 IPA 上传步骤成功；交接时后续模拟器启动步骤仍在运行，不能把整次运行或原生启动写成通过。此次交接提交另外保留 DEBUG 启动检查中的实际打包 Worker 检查，尚未执行，不改变已交付 Release IPA；交接提交使用 skip ci，避免另起重复构建。

下一步先查看上述运行最终状态和日志，排查 `scripts/ios-simulator-smoke.py` 中模拟器启动／编译等待，补有界超时并核对目标 iOS 27.0 运行时（目前脚本选最高已安装版本）；验证 WKWebView 启动、WebCrypto、打包 snapshot-worker、原字体及原生桥接，再测导入／导出／系统文件／自动备份。不要将已通过的 Swift 核心或设备编译当作上述 UI／文件流程已通过。Apple 签名、爱思安装及 iPhone 14 Pro / iOS 27.0 真机验收均未完成。

系统目录选择、持久书签在设备重启／授权失效后的行为、第三方文件提供者、系统分享、iOS 键盘与安全区、冷启动及自动备份大数据等待均须原生环境和用户真机复测。自动备份仅应用运行时按原十分钟／有修改规则执行，不承诺 iOS 后台定时。没有卸载、清库、操作前副本或真机通过结论。

官方依据：[Capacitor iOS](https://capacitorjs.com/docs/ios)、[Swift 插件](https://capacitorjs.com/docs/plugins/ios)、[GitHub Xcode 27 环境](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md)、[爱思 IPA 签名说明](https://helper.i4.cn/news_detail_38195.html)。
