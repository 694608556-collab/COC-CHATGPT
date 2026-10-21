# 公司电脑接续交接（2026-10-22）

## 当前交付与分支

仓库：694608556-collab/COC-CHATGPT。Android 开发分支 codex/ui-optimization-experiment；iOS 开发分支 codex/ios-ipa-adaptation。两端独立演进，接续时先 fetch 并核对远端 HEAD；本文件所在上传提交包含相应平台最新安装包及校验，不新增正式 Release/tag。

- Android：1.0.8/build51，应用源码 819262859e92794484fd39e1cf48dd8ddbfbff4a，性能修复 592226a96bb273409948df0e322a8ca7adcf5299。APK 位于 mobile/releases/1.0.8-51/coc-logbook-1.0.8-51-workerperf-8192628.apk；原发布证书、包名 coc.logbook、非调试版。SHA-256 f4849cced4a239518c7efc772327f7a18a51fc96599a6ff2c8eeb036b2ac2abb。
- iOS：1.0.8/build49，应用源码 d83e6a1e0315d1966ae64f544e5726b0756a20c1。IPA 位于 mobile/releases/ios-1.0.8-49/coc-logbook-1.0.8-49-fetchreuse-d83e6a1-ios-arm64-unsigned.ipa；设备 arm64、未签名，沿用用户现有全能签配置。SHA-256 7f5e6ed474db897efe1c1843b41d6467ef2a164c3ea9858c7fa1817287210531。

每个包所在目录包含 README、.sha256 及公开 verification.json；安装前核对摘要。上传的是已验证的原文件，没有重新改签或重新生成另一份包。用户明确授权本次上传安装包；私人表格、链接、正文、日志、设备标识、数据库、密钥和描述文件不在此次提交内。

## 已完成与测量口径

- 两端差量保存、Worker 表格预览租约、仅写变化场次及完整关联/CAS/回滚已接入并完成上一轮原生验收。iOS 测试变量 first 重名与 production 测量的 undefined 外壳比较问题早已修复，不再作为当前阻塞。
- 正文返回后的高亮和自动定位在下一次任意点击/系统返回时清除；切换页面后回列表从顶部显示。用户接受 Android 底部系统手势差异，该项关闭优化。
- Android build49 修复 JSON 斜杠转义引起的“检测来源已变化”，按严格解码身份比较，真实来源变化仍拒绝。build50 改善原生 RawJson 分块读写；6.322 秒只测公开样本的原生存储阶段，不能代替整批时间。
- Android build51 把响应解析和完整上传准备放在同一 Worker，减少整份正文往返，并使用字节等价的系统 UTF-8/Base64 编码。类型、115 单元、124 完整 Edge、宿主原生检查及云端 39646097214 成功。
- 同一 S9/Android9/WebView78 的 114 场独立诊断：固定响应旧路径 58.528 秒，新代码 37.485/38.125 秒；真实联网旧路径 65.524 秒，新代码 49.832/48.968 秒。114 场全部成功、完整正文 SHA-256 一致。包含最终原生提交，排除正式 UI、实际 SAF 授权检查和自动备份，不能写成正式包点击到完成固定 49 秒。
- iOS build49 修复逐请求创建网络会话。109 单元及云端 39630579313 完整通过（86 原生核心、3 冷启动、7 系统 UI、3020 公开检测结果），专项网络运行 39630579262 成功。用户 iPhone14 Pro/Wi-Fi/114 场报告从旧约 41 秒降至新约 30 秒，是单次用户实测。
- S9 已按用户要求安装 build51，手机 APK 摘要与交付文件一致；安装命令 install -r，未卸载、未清库、未打开，安装结束无应用进程。用户随后表示“可以了”并要求上传交接，但未提供 build51 新的正式界面计时，不扩大解释为所有功能/性能验收通过。独立诊断包已清理。

## 接续工作

先读两端最新 mobile/NEXT-SESSION.md、mobile/SAFETY-POLICY.md、本文件及 mobile/TABLE-DELTA-VALIDATION-20261021.md；旧 mobile/TABLE-DELTA-HANDOFF-20261021.md 的暂停/失败章节仅作历史。性能细节分别读 Android 的 mobile/ANDROID-WORKER-FETCH-PERFORMANCE-20261022.md 和 iOS 的 mobile/IOS-BATCH-PERFORMANCE-20261022.md。

先核对正式安装包的检测、保存、重开与全文保留反馈，继续依据实机分段证据优化差量保存和批量确认，不能用桌面/模拟网络或原生局部时间替代用户完整流程。Android 本次 Worker 改动尚未移植到 iOS；跨端移植要分别验证，不用 S9 结果替代 iPhone。

容量方向已确认：先支持整库超过 64MiB，单场正文继续设限。当前仅完成 mobile/CAPACITY-EXPANSION-PLAN-20261021.md，代码仍 64MiB。下一阶段先拆用途预算并保持旧值，完成大库完整流式备份/恢复，再覆盖保存、批量、导入、自动备份、回滚及重开，最后用压力测试确定有限整库目标；不能只调大常量。

iOS 全能签外部目录选择器点 Open 无反应仍未修复，已按用户决定暂缓；不调整证书、描述文件、包名，也不要求改用七天个人签名。

## 本机接管与保护

开始修改前检查公司电脑实际工作区、暂存区、未提交及未跟踪文件，先作可恢复保护再接续；不得 reset --hard、git clean、覆盖本机修改或默认远端含全部工作。按平台使用各自工作区，避免整分支覆盖另一平台。

保留 refs/backups/home-handoff-20261019（06b40e807a7acb073d1795aad4744a05feb2bb18），不要自动应用或删除。家中历史安装包的本地删除是用户有意清理，不随源码提交，也不擅自恢复。此次只新增用户明确要求上传的最新包。

不得卸载/清空生产应用来测试、上传私人输入或签名材料。完整正文/关联校验、即时授权、CAS、事务回滚、自动备份和 Android v4/iOS v1 存储差异继续保留。安装、提速和验收结论都按实际证据记录。
