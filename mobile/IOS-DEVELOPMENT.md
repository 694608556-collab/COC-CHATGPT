# iPhone / IPA 独立分支

## 2026-10-19：全能签安装后目录“打开”无响应，build 31 处理中

用户反馈 build 30 经全能签安装后，系统目录选择器中反复点“打开”不关闭，首次配置无法完成；第一版没有此问题。第一版与 build 30 的 LogbookPlugin/LogbookArchive/Info.plist 目录实现无差异，不能宣称已证明是 UI 修正或某签名工具导致。当前实体 iPhone 未连接，私人截图不提交。

补充真正操作 UIKit 目录选择器的 XCUITest：进入公开空文件夹、点击 Open、检查回到业务界面和重启保留授权。首次运行 39146204127 的原有三轮启动通过，但新增测试目标因 PRODUCT_NAME 缺失而构建失败，未执行到系统 Open，不计作故障复现；生成测试目标的配置已修正。

build 31 新增仅 iOS 的“使用本机归档文件夹”明确选择入口，用户点击才创建/复用 Documents/归档，再走原读写探针、书签与持久化校验；没有默认绕过门禁、不改业务 SQLite/revision、不覆盖原导出或恢复操作前副本。界面明确说明该位置在“我的 iPhone → COC 跑团记录簿 → 归档”，卸载应用会删除此位置，重要备份应另存；原自选目录入口保留，iCloud 未被原实现支持，移除原来误导的推荐文字。本机入口先红后绿的组件测试及原生保留旧文件/失败保留授权测试已补充。选择器回调只接受当前实例、显式关闭、忽略重复结果，取消和滑动关闭会释放在途状态；这不等于已证明原系统提供器无响应的根因。

新增 CI 模拟器测试目录和首次授权重置只在 DEBUG + targetEnvironment(simulator) 且显式测试参数下存在，实体 iPhone / Release 不包含这条重置路径。新包为 1.0.4 / build 31，保留 build 30 的顶部和缩放修正，安卓仍为 1.0.4 / 29；最终原生系统 UI 结果待回填，不用普通网页/原生核心测试代替系统选择器验收。

## 2026-10-18 真机反馈：深色顶端模糊与输入聚焦放大（build 30 已构建，真机待复测）

用户已确认 build 29 个人签名、安装、首次启动及选择保存目录成功；重开授权、完整导出与大数据性能没有据此扩大为通过。随后真机截图显示深色状态栏区域有浅色模糊、搜索输入聚焦后整页放大且退出重进才恢复。截图含私人日志，不提交。

build 30 保留显示版本 1.0.4，安卓仍为 1.0.4 / 29。iOS 26+ 隐藏 WKWebView 滚动容器上下边缘的原生材料层，网页已有不透明安全区顶栏；仅 iOS CSS 跟随应用主题设置 color-scheme；仅 iOS 打包视口增加 maximum-scale=1，保留原字体与原控件尺寸，代价是限制此 WKWebView 的页面放大范围，正文应用内字号设置保留。没有用 16px 输入字体放大整个控件，也没有以 blur 强制回缩干扰输入光标。

本地 78 单元、类型、格式、ESLint、iOS 生产资源/八字体检查、主题与原字号尺寸专项通过。原生云端三次冷启动追加深色 color-scheme、视口策略与原生边缘隐藏断言及深色截图，最终结果见下文；这些不能代替实体键盘的真实点击聚焦、键盘收起、页面切换与横竖屏验收。新 IPA 必须重新在用户本机签名，沿用原签名账号/签名后应用标识尝试保留数据升级，不卸载或清库，不上传个人签名材料。

完整 94 浏览器回归通过。首轮 build 30 云端 39137734935：设备 Release 成功，首次原生启动连同三项新断言通过；第二次仍触发 WKWebView `Completion handler for function call is no longer reachable`。此前 a1bc497 的全局任务引用未完全消除此诊断异常，不把先前三次绿灯当作永久解决。d07c61a 将 DEBUG 通道改为 evaluateJavaScript 启动页面任务、原生每 250ms 读取已完成 JSON，90 秒到期明确失败，继续执行同样的三次冷启动及所有断言；此改动不进入 Release 行为。失败记录、截图和日志保存在仓库外。

d07c61a 的运行 39138680936 仍在页面任务等待 90 秒后失败，不能称为异步诊断已完全修复；随后 2fd2e78 增加首页 DOM 与原生桥接就绪检查，再启动页面任务，并保留具体进度与有界期限。最终 [39139704865](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39139704865) 成功：78 单元、24 Swift 核心、设备 Release 通过，三次 iPhone 14 Pro / iOS 27.0 冷启动及新增外观/视口断言全部通过。尚未用导航跟踪证明全部历史失败只有一个原因，不作无限稳定性保证。已核看深色原生截图，顶部无原浅色渐变；诊断 DOM 深色不等于用户实际主题切换，系统状态栏图标颜色仍由真实设置复测。最新 [build 30 未签名 IPA](releases/ios-1.0.4-30/README.md) 已独立复核并交付，实际键盘聚焦/关闭、切页、旋转及明暗切换仍待用户签名安装后反馈。

## 2026-10-18 接续：以最新安卓优化及 1.0.4 / 29 为基线

已保留原 `01475f49` 及旧 1.0.2 待签名 IPA。接入 Android 优化源码 f36be68 和 1.0.4 构建提交 2b50fc6；安卓 APK 独立位于 [1.0.4](releases/1.0.4/README.md)，不从旧 iOS 分支降级安卓。iOS 工程与打包校验同步 1.0.4 / 29，但设备包仍须 macOS 云端构建，不假称 Windows 可以执行 Xcode。

旧云端运行 38878820982 最终为失败：设备构建/IPA 上传成功，iPhone 14 Pro / iOS 27.0 模拟器已启动并安装，但 WKWebView 检查仅报 JavaScript 异常；不是卡在编译，也不是启动已通过。现在固定要求 27.0 运行时、给全部子进程设置超时，DEBUG 原生检查输出具体阶段、错误/堆栈和 WebCrypto 可用性，并实际运行打包 snapshot-worker 与 export-worker 公开正文任务。[新云端 39111979457](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39111979457) 已通过：原生概览、snapshot-worker 结构读取、export-worker 实际公开正文导出、WebCrypto 已知摘要、原字体加载及 secure context 均成功，阶段 complete。旧 1.0.2 失败未在最新代码重现，原错误缺少具体堆栈，不能断言某一单独根因已被证明。

最新对应源码 c84b385 的运行 39112480711 已发现间歇失败：原生系统确认为 27.0、应用 1.0.4，页面已正确显示；WKWebView 返回 `Completion handler for function call is no longer reachable`。[Apple 官方文档](https://developer.apple.com/documentation/webkit/wkwebview/callasyncjavascript(_:arguments:in:in:completionhandler:))说明异步结果在完成前被回收可产生此错误，已在 a1bc497 将 DEBUG 检查任务保留在页面全局直到返回，[最终运行 39113606548](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39113606548) 对应源码 1617069 已通过连续三次冷启动，三次均 complete，原生系统 27.0、应用 1.0.4、两个 Worker、WebCrypto、字体及原生概览全部通过；这是有限重复验证，不承诺所有设备永不失败。失败 JSON/截图及构建日志只保存在仓库外。

最新 Android 专用私有读取、分段编辑、文字 PDF 及导出暂存接口只在 Android 调用；iOS 保留既有完整读取/事务写入、完整浏览器 PDF 生成及原生新建回读保存，不能因 Capacitor.isNativePlatform 为真就调用未注册的 Android 方法。保留 iOS 安全区、前后台监听与原生书签；根页面不调用 iOS 不支持的 minimizeApp。原字体、正文、CAS、事务、十分钟有修改才自动备份不变；没有迁移/打开安卓私有数据库。

另保留 Android 与浏览器验证器既有 PDF 暂存，只对 iOS 使用完整文件写入；本地追加两项平台契约测试通过（78 单元）。iOS 首次目录与设置文案使用系统“文件”及位置授权描述，不再向 iPhone 展示存储卡/root 操作说明，Android 文案和按钮尺寸不变。

iOS 大正文性能与原生文件流程仍须独立验收，不能继承 S9 通过结论。家用 Windows 检测到爱思助手 8.0，当前未检测到已连接 iPhone；签名/安装等待用户连接并在自己的爱思界面配置 Apple ID 或有效证书，不索取聊天中的账号密码，不伪造真机通过，不发布或合并 PR。

最新 [1.0.4 / 29 待签名 IPA](releases/ios-1.0.4/README.md) 已保存并复核云端 ZIP/IPA SHA-256、arm64、版本、全部网页/Worker 产物与八份原字体；没有签名证书/用户数据。最终 78 单元、类型/格式/ESLint、24 项 macOS Swift 核心、完整 93 浏览器回归通过。新增平台导出测试使用原生字节比较保持全量完整性，避免递归比较大数组在云端触发 5 秒测试超时；未放宽超时。爱思签名/安装及真实系统文件授权、全文大数据性能、自动备份仍待 iPhone 连接后验证。

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

完成平台分支回归修正及 iOS 专用目录文案后，再次构建对应源码的待签名 IPA，最终运行/摘要待回填。
