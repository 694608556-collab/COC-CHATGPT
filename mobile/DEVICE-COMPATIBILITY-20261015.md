# 新增手机兼容性检查（2026-10-15）

最新补充：S9 已以 Android 9 / WebView 78.0.3904.108 完成 0.2.16 独立版保留数据升级、受控启动／编辑及正文桥接回归，范围见 [实测记录](S9-EXPERIMENT-20261015.md)。三台新增设备仍无实机结论；下方“不生成／安装 APK”描述的是本文件最初检查阶段，并非最新全项目状态。

检查基线：`codex/ui-optimization-experiment` / `38aa7fb`（UI 试验 3），软件仍为 0.2.14-dev / versionCode 17。本轮调整 WebView 安全区域策略并记录检查，不生成、安装或发布 APK。公司没有这些手机；**三台均未真机验收**，浏览器、静态检查或资源构建不能替代。

## 设备清单与当前结论

| 设备 | 用户提供的系统 | 源码检查结论 | 仍缺的证据 |
| --- | --- | --- | --- |
| 三星 S9（原基线） | Android 9 / 历史 WebView 78 | minSdk 28 和旧内核构建目标保留；本轮不改变旧内核的原生边距分支 | 新 UI 试验的输入法、拖动性能、真实文件 I/O 仍待复测；旧结果不扩大 |
| 华为 Mate 40 Pro | HarmonyOS 4.2.0 | 按 HarmonyOS 4.x 的 APK 路径检查；无 GMS 运行依赖，Capacitor 单独识别华为 WebView；未发现明确阻断 | 实际 Android API、WebView 提供程序／内核、安装与系统文件选择器均待确认 |
| 红米 K80 | OS 3.0.308.0.WOKCNXM.C09 | 按现代 Android 的安全区、系统返回、SAF 文件路径检查，预先检查 Android 15／16 行为变化 | 现有官方资料不能确认此完整构建对应的 Android 版本；保持未知，不将推测写为设备事实 |
| 荣耀 90 | MagicOS 9.0 / Android 15 | 用户提供的 Android 15 超过 minSdk 28；已使用 AndroidX 返回链，安全区缺口已在源码修正 | 实际 WebView、挖孔／横屏、输入法、文件授权及系统手势待实测 |

用户目前拿不到更多版本信息，检查不因此中断；以后获得信息再补充，不要求其先升级系统或更换内核。本结论只覆盖表内系统，不能外推到不同 HarmonyOS 大版本或其他设备。

## 已完成的检查与修正

- 最低 Android 9（API 28），compileSdk／targetSdk 36。没有为了新机提高最低版本，也没有降低 targetSdk 来回避新系统行为。
- 网页产物仍以 Chrome 69 为语法目标，保留 core-js、UUID 兼容和全部原字体。普通 WebView 最低版本配置为 69；华为 WebView 使用 Capacitor 的独立版本编号（默认最低 10），**不能把华为的 10 当作 Chromium 10**。
- 当前原生运行模块为 Capacitor core／android、App 及本地 Java 存储插件；没有 google-services.json 或 GMS 运行调用。Gradle 中可选的 Google Services 配置没有启用；不需要朋友手机安装 Google 服务。没有新增厂商私有 SDK 或按机型硬编码。
- App 8.1.2 使用 AndroidX `OnBackPressedDispatcher` / `OnBackPressedCallback`，项目 Activity 依赖为 1.11.0；应用监听 `backButton` 后沿用关闭候选、关闭弹窗、草稿确认、写入中阻止离开的保护。未使用 Android 16 已停止分发的旧 `onBackPressed`／返回按键拦截，也未申请系统手势排除区。实际键盘返回顺序、预测性返回动画与 OEM 组合仍须验证。
- **修正较新 WebView 的安全区缺口**：生产入口原先指定 `viewport-fit=cover`，但顶部及横向布局没有为状态栏／挖孔加完整留白；Capacitor 8.5.3 在 WebView >= 140 时透传这些区域，存在遮挡风险。开发／生产入口现统一明确使用 `viewport-fit=contain`，沿用 SystemBars 默认启用的处理，让其为系统栏、挖孔、横屏两侧及键盘设置原生边距。旧内核本来就走此边距路径。系统窗口仍遵守 Android 15／16 的边缘到边缘要求；没有使用已废弃的系统 opt-out 标志。
- SystemBars 已处理 IME insets；UI 试验 3 的 VisualViewport、无此接口的短窗口回退、中文组合键保护保留。不叠加 Keyboard 插件或重复原生缩放；保存／取消和候选实际避让仍须真键盘验证。
- 归档使用 `ACTION_OPEN_DOCUMENT_TREE` 与持久读写 URI 授权，导入用 `ACTION_OPEN_DOCUMENT`，分享使用 content URI、ClipData 和临时读授权，没有直接存储路径或全盘权限依赖。Android 11+ 应选择普通可授权子文件夹（如 Documents 内自建文件夹）；存储根目录、Download 根目录、Android/data 和 Android/obb 有系统限制。取消、拒绝／撤销授权时保留原有效数据。
- 未新增本地 `.so` 依赖或 CPU ABI 限制；这是源码依赖检查，不是最终 APK 的 16 KB 内存页／ABI 验收。
- 原字体、控件尺寸、全部正文、三模块、CAS／事务保护未变。排序即时保存，自动备份默认十分钟、有修改才生成，不生成操作前副本。锁屏、切后台或系统杀进程期间不承诺准点备份，不为适配新增常驻后台任务。

## 本轮验证边界

- `pnpm format:check`、`pnpm typecheck`、`pnpm sync` 通过。同步后的 Android public/index.html 和正在服务的浏览器入口均为 `viewport-fit=contain`。
- 4 项既有 Edge 隔离浏览器流程通过：可见区域缩小／偏移、无 VisualViewport 回退及失败保留草稿、原控件尺寸与多选切换、120 项长导入弹窗固定操作区。证据为本机忽略的 `evidence/device-compatibility-20261015`，只使用公开样本。
- 未运行 Android Gradle 构建、模拟器或新增设备；没有本轮 APK 安装结论。浏览器没有真实 Android SystemBars、OEM 文件选择器、系统返回动画和后台限制，不能据此填写设备通过。

## 三台手机后续分别填写的实测项

1. 同一测试包安装、启动、保留数据升级；记录包提交、系统与 WebView 版本，不卸载／清库来制造通过。
2. 三模块、正文搜索跳转、角色 PC 候选、竖横屏和系统字体放大；系统栏／挖孔不遮挡，原尺寸按钮可操作。
3. 系统及实际常用输入法：中文组合输入、候选、长文本、键盘开合；保存／取消可见。系统返回先处理候选／键盘／弹窗，草稿离开有确认，处理中不误退出。
4. 普通子目录授权、重开、超过 50 场导入、完整正文保存重开、PDF／DOCX／JSON 导出分享；取消／失败保留原数据和草稿。先用公开样本，不覆盖朋友真实数据。
5. 同一完整样本测编辑／批量保存及备份并行等待；前台满十分钟后有修改才备份，无修改不新增；回前台版本／目录检查正确。分别记录后台回收与限制，不用浏览器耗时替代手机耗时。

## 保留与回滚

本轮之前的 UI 试验 3 提交 `38aa7fb` 已保存本地与 GitHub 分支 `codex/ui-optimization-stage3`；原版 `14efc29`、试验一 `bf0b4fd`、试验二 `1e2d327` 保留。仅继续独立试验分支，不合并 PR、不正式发布。回滚指源码，不安装旧数据库版本或清空应用数据。

## 核对依据

- [Capacitor System Bars：WebView 140、viewport-fit 与安全区处理](https://capacitorjs.com/docs/apis/system-bars)。同时核对本机锁定版本 8.5.3 的 SystemBars.java，未只依赖可能更新的在线文档。
- [Android 16：边缘到边缘与预测性返回变化](https://developer.android.com/about/versions/16/behavior-changes-16)。
- [Android：迁移系统返回回调](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture)。
- [Android 11：SAF 目录访问限制](https://developer.android.com/about/versions/11/privacy/storage)。
- [华为：HarmonyOS 4.2 等系统的 APK 安装与分享说明](https://consumer.huawei.com/cn/support/content/zh-cn01089223/)。该说明仅证明存在 APK 安装路径，不证明本应用已在 Mate 40 Pro 运行通过。
