## 2026-10-21 阅读返回与批量检测反馈接续

本次两端共同前端修复任意点击后旧阅读高亮/自动定位残留，并减少检测弹窗进度对后台列表的重复渲染。见[NEXT-SESSION最新章节](NEXT-SESSION.md)及[本轮验证报告](READER-RETURN-BATCH-CHECK-20261021.md)。差量协议、原生事务、64MiB与容量方向保持；本轮源码改动尚未交付新IPA/APK，不把浏览器测量当作手机实测结论。

## 2026-10-21 最新用户决定：全能签配置保留，目录兼容暂缓

用户要求保留现有全能签长期签名，不调整证书、描述文件或应用标识。当前没有已验证的仅改应用代码恢复外部目录方案，按用户决定暂缓此项，保留本机归档入口；问题仍未修复，不要求用户切换个人ID重签。以下“优先全能签外部目录”由本节取代，实机诊断见iOS分支IOS-EXTERNAL-DIRECTORY-20261021.md。Android上滑优化仍关闭，现有差量成果与容量方向保留。

## 2026-10-21 用户确认：当前任务优先级

Android底部上滑/后台化行为获用户接受，不再优化或要求专门保证回到启动器；保留实现，此项按需求决定关闭。当前优先处理iOS全能签企业签名后无法点选系统外部目录，尚未有该环境复现与修复结论。完整需求决定见NEXT-SESSION.md顶部；此前差量成果及验证保持，已交付仍为两端1.0.8/build48。

## 2026-10-21 家中接续完成：差量原生验收与追加优化

iOS测试重名已在ca05adb修复，production完整编码等价测量在4e6d90f修复；类型/109单元/118完整Edge及39586805588完整成功：86核心、3冷启动、7系统UI、3020公开结果、4批量CAS/0旧正文整读，另2次表格差量CAS。Android4897fe2补正文类型与完整角色/模组关联校验，ddc55bb复用已校验的无正文新增SQL；107单元/112完整Edge、S9隔离包16原生及2次追加回滚复验、39592130273全部通过。

同一S9公开1000→7000场原生差量事务5123.902ms单样本，优化后三次878.631/820.746/891.874ms，中位878.631ms；写入阶段4710.205→中位425.077ms。此为原生事务，不能替换历史1050→7050界面6.973秒。iOS构造诊断追加1026ms、单手动1068ms，仍用完整Worker prepare，不代表生产租约全路径或实体iPhone。

用户已确认容量方向：先支持整库超过64MiB，单场正文继续设限。本轮仅形成方案，代码仍保留64MiB；先完成预算拆分与完整流式备份/恢复，再按压力数据确定有限整库目标。完整结果、首次失败/复验与范围见[TABLE-DELTA-VALIDATION-20261021.md](TABLE-DELTA-VALIDATION-20261021.md)，容量接口/实施顺序见[CAPACITY-EXPANSION-PLAN-20261021.md](CAPACITY-EXPANSION-PLAN-20261021.md)。

没有新版本发布或安装包交付，两端已交付仍1.0.8/build48，旧包保留。原目录/即时授权、完整关联、CAS、事务回滚、自动备份及Android v4/iOS v1差异保留。桌面与两个旧本地工作区保持，refs/backups/home-handoff-20261019仍06b40e807a7acb073d1795aad4744a05feb2bb18，未应用/删除。实体iPhone、企业签名外部目录、正式生产包升级及生产租约端到端计时仍待保护真实数据后验收。

以下暂停及较早章节为历史，最新状态以上述结果及本轮报告为准。

# 2026-10-21 差量保存开发暂停交接

用户要求暂停并上传进度；本文件为最新状态。开发尚未完成，不是新安装包交付。接续优先顺序：先完成差量保存及大批量确认优化，最后再确认超过64MiB的容量扩展方案。

## 当前源码与验证

- iOS应用源码 bf7146f53c27b08ef489ad69ac1a8750c83597d9（基础差量 d116e9b），分支 codex/ios-ipa-adaptation。类型、109单元、118完整Edge通过，0失败/跳过/flaky。
- Android应用源码 9ce20a923b219e4919aa197d13822dff55dd1743，分支 codex/ui-optimization-experiment。类型、107单元、112完整Edge通过，0失败/跳过/flaky。
- iOS 39581113860 / job 119158667137 **失败**：新增 `scripts/ios-native-tests.swift:194` 的 `var first` 与同一作用域已有变量重名，Swift报 `invalid redeclaration of 'first'`。首轮39580520487也在原生检查步骤失败。最新日志错误已明确，但遵照暂停要求未继续修复。最新轮类型/单元通过；Swift原生核心没有执行，IPA构建、冷启动、UI与WK大库计时均跳过，不能算原生验证成功。
- Android 39580675751 / job119157197025成功：类型/单元/网页、Debug/Release/DebugAndroidTest编译通过。**仪器测试未执行**，当前没有实体测试设备。
- iOS另保留未完成的 `scripts/profile-table-confirm.mjs ... production` 分析模式。首次 `single production` 在严格对象比较失败：applyTableDelta/restoreTableBodies返回的记录有 `rawContent:undefined`/`manualContent:undefined` 外壳，预览规范对象缺少这些键；不能把这次记作四场景等价成功。应先核实序列化JSON/完整复验结果确实等价，再修正测量层比较，不能放宽真实业务字段断言。append/participants/characters未执行。该脚本修改不影响应用，随暂停提交保存。
- 本轮没有新的原生耗时、实机提速或安装包结论。两端已交付包仍为1.0.8/build48，releases/旧包不改；当前CI产物不能冒充新的已验交付。

## 已实现但仍待完成原生验收的代码

1. 两端新增明确能力 `tableDeltaVersion:1` 与独立 `commitTableDelta`；无能力时只在发送写入前走旧commitTable，不在超时/失败后换接口盲目重放。
2. Worker预览保留唯一、绑定revision的基线与候选租约；确认完整校验后抽取差量并重建校验等价。取消/成功/替换预览/unmount释放对应租约；丢失Worker、失效token、revision不符拒绝，要求重新预览。界面不再把完整候选回传Worker确认，但Worker仍完整校验，并返回完整元数据更新界面；不宣称消除所有全库处理。
3. 差量协议为protocolVersion、initialSettings和五个完整实体数组modulesAdded/moduleParticipants/charactersAdded/recordsAdded/manualUpdates。initialSettings只在原生确认全新库时初始化；非新库必须与原设置一致。已有模组仅允许kps/pairs变化；已有手动场次仅manualContent/updatedAt/playDate/dateSource变化。没有删除、重排、任意补丁、在线正文或来源覆盖。
4. iOS独立 `LogbookStore.importTableDelta`：单CAS事务中读元数据、白名单合并、完整最终图校验，只写新增/明确更新记录。旧记录不再全部序列化比较，也不调用旧commitTable中的额外store.metadata()重读。保留v1与全库容量汇总。明确手动更新用JSON编码参数的SQLite json_patch，避免直接绑定含NUL文本截断；Windows SQLite公开小检查通过，但新增Swift NUL/空行/Unicode重开断言尚未运行。
5. Android独立 `IndexedSnapshot.importTableDelta` 与 `TableImport.delta`：白名单合并后完整SnapshotStream校验；只写新增/手动更新，追加末尾仍每事务计算一次。保留v4正文块与长度索引，不覆盖iOS平台实现。
6. 原目录/即时授权、revision/CAS、事务/SQL与容量失败回滚、64MiB和自动备份规则不变。原生代码仍需进一步审查和实际执行新回归后才能宣布完成。

## 接续操作

1. 先保护家里机器未提交及未跟踪修改，检查最新分支；不要reset/clean覆盖本机工作，不自动应用或删除 refs/backups/home-handoff-20261019（06b40e807a7acb073d1795aad4744a05feb2bb18）。读取最新NEXT-SESSION、本文、SAFETY-POLICY、IMPORT-OPTIMIZATION以及TABLE-DELTA-ASSESSMENT，最新章节优先。
2. 先修复iOS原生测试局部变量重名（将新增first改为唯一名字并同步本段引用），再运行完整Swift核心、构建、3冷启动、7UI和3020结果/大库计时。不要把旧轮68核心通过当成本轮delta原生通过；原精确姓名断言/超时不放宽。
3. 审查差量协议完整关联/未知字段/重复冲突/新库/旧能力/丢失回复/Worker失效等边界，补缺少的原生用例。Android新增6000场压力、SQL/容量/CAS回滚仅编译，仍需执行；尤其补明确手动更新/重开及原始正文块证明。
4. 修复production主机测量的undefined外壳比较问题后，运行single/append/participants/characters四场景，以真实编码器核对完整JSON等价及字节，不冒充设备速度。Node脚本需在mobile目录执行，依赖nodePaths指向mobile/node_modules。
5. 同一公开场景对比差量前后分段耗时，进一步优化大批确认。iOS新ios-scale-webview脚本改用delta原生接口，但仍使用完整Worker prepare并在诊断JS中抽取差量，已在结果preparation字段明确；它不代表生产租约全路径耗时，后续最好增加真实表格/租约测量。本轮因Swift编译失败，脚本尚未运行。
6. 本机完整浏览器使用PLAYWRIGHT_CHANNEL=msedge、CI=1，按分支串行运行。当前完整118/112皆通过，详见verification/table-delta-20261021。6000场真实Worker预览/取消/完整保存重开已通过。旧正文不进入JS的既有回归保留。
7. 功能与性能验收完成后再决定下一版本打包；容量扩展最后单独设计导入/备份/恢复，不只提高64MiB数字。目前无设备，iPhone/企业签名目录/第三方提供器、正式签名APK生产覆盖升级仍待保护真实数据后验收。

## 保护与历史基线

公司电脑455个保护文件SHA复核0变化；独立工作区开发，桌面codex/desktop-0.8.9/d3e943e未改，不清空/卸载生产应用、不恢复操作前安全副本、不上传私人正文/数据库/设备序列号/签名材料。两端原生实现差异保留。

差量前计时基线：iOS549487d/39568381821已完整成功，模拟器构造场景追加6000约1094ms、7050单手动约1807ms，原生后者1688.9ms，完整元数据读取/校验/比较占主导。与S9约50MiB的6.973秒/3.769秒不是同设备同正文体积，不直接相减。原build46导入旧正文不跨JS和build48姓名候选修复均为历史已交付成果，不因本文暂停而重新列为未修复。
