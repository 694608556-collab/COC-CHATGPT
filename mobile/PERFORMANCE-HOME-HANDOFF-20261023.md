# 2026-10-23 家庭续接：阶段2仍未验收

家中原有工作区的未提交、暂存、未跟踪和有意删除状态已独立保留，继续在新隔离工作区开发。S9已连接；家中目前没有iPhone，先完成可运行的验证。此处优先于下面的公司暂停记录，但仍不是正式版本交付。

- 新records生产C核心已在S9两个ABI分别完成原33+新增38共71项真实差分；Android整包构建、原58+新增4共62项原生回归和原TableStreamTest五项通过。
- iOS测试脚本修复提交 `54134e3`、Swift非可选String测试修复 `67ba778` 已推送；`67ba7788365369dee3abe1b97fe923727985278b` 的完整CI `39944673451` 主任务、独立完整I/O和汇总均成功，包含1163项Swift断言、71项实际C差分、3次冷启动及7项系统UI。该成功不覆盖本段之后的共享性能改动。
- 本次共享改动保留可选records分段诊断；大候选行复用既有Worker完整UTF8编码；仅单片段且解码未改变的单元格复用已校验字节数；候选SHA计算与原生append等待重叠，仍等待全部ACK后才能成功。较大内容和解码变化继续完整原路径，没有新增内容配额。
- iOS新增CSV/XLSX/XLS各自全新模拟器首测入口，每次仍跑全部九次预览、115条完整提交和独立SQL回读；默认完整I/O继续单独必跑，100/500逐次门槛不变。聚合报告开始即标记未完成，不能残留上次成功。该新冷矩阵尚待对应源码CI实际执行。
- Android真实问卷完整校验持续通过，最近一次完整预览约907/790/611ms，仍三次失败；该轮尚未包含随后加入的SHA等待重叠。114个链接在线全文尚未获取，不能称正文搜索已验收。搜索、iOS PDF、最近保存和最终全量交付仍按原顺序待做。

私人输入、原始日志、签名材料保留本机。正式应用未卸载或清库，没有发布新安装包。后续仍需当前源码的完整回归、S9真实性能复验和iPhone实测。

# 公司暂停时记录（保留溯源）

用户因下班要求暂停开发并保存 GitHub。本次是未完成开发的检查点，不是新版本交付；原 APK55 / IPA53 仍为已交付版本。本文与 NEXT-SESSION 顶部优先于历史“全部通过”段落。

## 先保护本机，再续接

分别检查家中各仓库未提交、已暂存、未跟踪及有意删除状态，保存本机独立快照；不要 reset、clean、覆盖原工作区或自动恢复旧安装包。在独立 worktree/目录读取原分支最新远端提交：Android `codex/ui-optimization-experiment`、iOS `codex/ios-ipa-adaptation`。公司开发镜像的本地 Git 是独立重建基线，不能把其历史直接 push 到原分支；本次上传使用真实远端父提交和 expected_sha，保留历史。

公司原工作区保持；本机保护摘要在工作区外层 `preserved-local-20261023-performance-f14a0f63/summary.json`。私人输入、原始日志、签名材料及本地环境路径没有上传。`refs/backups/home-handoff-20261019` 保留；Android 手势关闭、iOS 外部目录暂缓。不得卸载/清空/自动打开正式应用，不得重建用户有意清理的旧正式安装包。

## 用户要求与固定顺序

“瞬间”：可见响应≤100ms，完整角色卡草稿、完整表格预览、完整正文搜索结果≤500ms；首次与后续逐次通过，不能取平均或最快值代替；对照50版及以前，旧版本更慢不能放宽门槛。真实耗时从用户操作至完整结果可用，不能前移用户数据处理、隐藏异步尾工或改计时终点。

顺序：1角色卡 → 2表格 → 3正文搜索 → 4 iOS PDF → 5最近保存 → 6双端所有测试与交付。每阶段增加并运行有效测试；失败先修复后继续，不删/跳/降低验收，最后跑所有测试。角色卡已在可用设备通过；阶段2仍失败，当前停在阶段2。

最近保存新增要求：备份、合成、批量导出等显示顶部最近保存面板时自动回到顶部；3秒没有点击则渐隐消失，点击重置3秒计时；仅隐藏面板，不删除文件或保存记录。尚未实现。

不得恢复单场64MiB或任何固定内容配额；不得截断正文、忽略尾部/其他表/CRC/关系校验，或弱化授权、CAS、事务回滚、自动备份。快路2MiB来源/8MiB展开/2MiB投影只是有界驻留预算，超预算必须走完整原流程，不是文件拒绝上限。

## 已取得的证据（不是暂停源码全量验收）

- 阶段1三张真实角色卡约739–801KB：S9候选24首次437/460/431ms、后续268–339ms；候选25首次496/452/424ms、后续279–300ms，两轮各9次逐次通过100/500门槛，所有字段/警告/待填项与原完整导入器摘要一致。
- 同机旧48版隔离重建，源码 `8f01cf485da33555e3240967d22e0c8e9ad3c8c2`：首次1908/2034/1813ms、后续980–1188ms；原55约6.1–6.6秒。没有恢复旧正式安装包。
- 早期阶段1Android247单元/150完整浏览器、iOS241单元/156完整浏览器通过。原33项C核心真实32/64位差分及6项Android原生核心测试通过；这些不覆盖刚加入的records投影代码。
- iOS阶段1独立完整I/O `39914274459` 成功，角色卡152/51/57ms；联网隔离 `39914274549` 成功。完整任务 `39914274433` 后段环境失败，不能写成全任务通过；iPhone本轮不可连接，只有S9实机，不能宣称iPhone恢复旧版速度。
- 阶段2候选37的46项S9原生测试通过：TablePreviewBatch(8)、TableResidentText(2)、TableSeedMetadata(3)、TableSmallContent(6)、StrictTableJson(9)、TableCodeWarm(6)、TableParticipantCache(3)、TablePreparedSeed(4)、TableInlinePreview(5)。原TableStreamTest的5项大表格/大正文测试在较早候选通过，最终仍须重跑。
- 候选37公开115行完整预览：CSV 755.7/399.5/380.4ms，XLSX 334.4/326.5/353.5ms，XLS 340.6/314.7/349.4ms；均响应<100ms，但冷CSV失败。当前每次进程先测CSV，XLSX/XLS尚须补独立进程首次测试，不可将同一进程后续格式称为冷启动。
- 同候选真实表格完整预览1145.7/826.4/784.7ms，响应61.1/19.7/18.6ms，完整候选、4段完整手动正文及原78场正文不变验证通过，性能3次均失败。不能用公开表格代替真实输入。
- 最新共享records适配、私人整表证明和平台返回入口共49项相关测试在双端通过，双端类型检查通过。新增records C投影的原33+新增38共71项旧完整读取器基线通过；未运行native时输出nativeDifferential:false，只能称基线验证。

## 暂停点：新records原生投影尚待验证

为消除真实XLSX约600ms的JS全表读取/解析，刚增加跨平台C接口 `coc_table_kernel_records`。保持ZIP/DEFLATE/CRC/关系/全部SST/所有表全单元格校验，返回完整行、合并、公式与原值，再由原JS worksheet/import解析器映射全部候选。不是直接绕过业务解析。

原生返回 `recordsKernel:{source,payloadJson}`，避免Java/Foundation深层解析后再序列化；JS worker严格校验完整协议、来源证明、全部索引/行/格，再生成原候选。原来源磁盘SHA/EOF、候选SHA、预览和提交授权/CAS/回滚保持。Android完成来源捕获后将当前租约私有索引seed与JS解析重叠，仍计入真实操作全耗时；启动只预热公开字面量代码。

关键文件：`native/table-kernel/table-kernel.cpp/.h`、Android `NativeTableKernel.java`/`TableSession.java`/`LogbookPlugin.java`/JNI、iOS `LogbookTable.swift`/`LogbookPlugin.swift`、`src/data/table-kernel-records.ts`/`table-stream-job.ts`/`table-stream-client.ts`、`tests/native-record-kernel-corpus.ts`/`table-record-kernel-differential.ts`。

候选38第一次构建失败：C++ `quoted` 与 `std::quoted` ADL冲突；现已统一内部名称为 `jsonQuoted`，生产核心32/64位CLI均编译成功。尚未重新构建完整Android APK、未跑新6项NativeRecordTableKernelTest、未在S9跑新的71项真实C差分、未复验公开及私人表格耗时。不要把“已修编译名冲突”写成新APK已通过。

Swift新增records桥及完整来源、38项corpus、完整351021字节Unicode/NUL/CRLF正文提交/重开、候选证明、CAS、授权与SQL回滚检查。Windows无swiftc，新增Swift尚未编译/运行，必须在macOS验证。

## iOS CI与已定位问题

上传前原iOS远端头 `dd287d54794679e56cf7d3c5847f8bbb6f306319`，任务 `39934062424`：截至暂停查询，主任务已过核心/大正文/IPA构建、仍在冷启动；独立完整I/O失败于旧测试对iOS不存在的 `.app-back` 点击。此时还没有本轮角色卡/表格耗时证据，整体不能判通过。

已修共享 `tests/public-io-navigation.ts`：Android点击真实按钮且要求存在；iOS触发生产导航手势使用的 `logbook-back` 事件。保留真实溢出文件、1500ms延迟暂存、取消无编辑页/无revision写入、等待在途工作断言，并新增2项平台测试。原7项系统界面真实手势检查不删。修复尚未经过完整iOS I/O任务。

前任务 `39925173462` 两次完整I/O在业务开始前安装超时，主任务241单元/33差分/901原生核心/3冷启动/7系统UI/大库成功；`39922545103`也有容器环境失败。保留原限时、测试和失败传播，不无限重跑碰运气。调度契约23项、角色卡验收5项、表格验收11项通过。当前工作流要求主任务与独立完整I/O都成功；后者不可从完整结果中排除。

## 家中第一步怎么做

1. 安全读取本次检查点后在两端mobile目录安装锁定依赖（pnpm install --frozen-lockfile），运行typecheck、pnpm test；构建生成物和字体保留原版本。重新建立本机SDK/NDK28.2.13676358/CMake3.22.1、JDK21和Node24环境，不提交本机路径。
2. `node scripts/check-table-kernel-vendor.mjs` 验证官方Expat原件；`node scripts/check-table-kernel.mjs`生成公开夹具及完整读取器基线。macOS先`bash scripts/build-table-kernel.sh`，再`node scripts/check-table-kernel.mjs ios/build/table-kernel-host/coc-table-kernel-probe`，必须输出实际native差分成功。S9两ABI生产CLI用法为 `<file>` 或 `<file> records`，分别保存原 `<name>.json` 与 `record-<name>.json`，再`node scripts/check-table-kernel.mjs --saved-results <对应ABI结果目录>`，71项全通过后再测性能。
3. Android `node scripts/public-io-fixtures.mjs`，测试构建设COC_PUBLIC_IO_TEST=1，`node scripts/build-web.mjs`、Capacitor sync android、assembleDebug及assembleDebugAndroidTest。确认包名仅coc.logbook.debug55与coc.logbook.debug55.test，再覆盖安装隔离包。先跑上述46项、原6项NativeTableKernelTest、新6项NativeRecordTableKernelTest，修复失败后跑原TableStreamTest及完整公共I/O。
4. 公共I/O instrumentation类 `coc.logbook.PublicIoTimingTest`，参数 `publicIoMode=tables` 执行九次完整表格验收，`complete`执行完整矩阵。入口 `coc.logbook.debug55.test/androidx.test.runner.AndroidJUnitRunner`；不能仅凭adb退出码0判成功，要检查JUnit结果和所有100/500断言。新测试也验证每次重新读取来源、没有启动读取用户数据。
5. 真实输入仅从用户手机按授权再次查找和在本机隔离测试；公司私人副本/摘要和原始日志不上传，家中不会自动获得。用户指明三张700KB左右卡片、文件名以20261019相关日期开头的XLSX问卷。已确认真实表格3表/118行=114个唯一有效在线链接+4段手动全文333711字节；完整原解析器和流式候选相等。表格不包含114场在线全文，必须后续正常抓取后才可验正文搜索。私人表格测试运行时参数 `localPrivateTable=true`、`publicIoMode=private-table`、`expectedTableProofBase64`；proof由原完整reader/parser独立生成，不能把被测实现自己的输出作为唯一oracle。新`tests/private-table-proof.ts`定义严格完整proof。
6. 真实表格输入仅在测试UID files/local-table-input.xlsx提供，provider授予隔离应用读取；每次完整预览/取消或最后提交都验证来源与候选SHA、所有链接、手动全文、原78场正文。结果/日志本机保存，公开交接仅写汇总。公司本机辅助脚本位于仓库外.tools，不应直接提交整目录；家中可以按已提交harness/接口重建便携runner。
7. Android表格仍需解决冷CSV，真实XLSX新快路也未计时；两端阶段2通过后才能进入搜索。iOS运行现有完整工作流，保留新增Swift检查及全部原测试；不能沿用旧成功任务代替新源码。只有S9可用的限制在公司成立，家中如有iPhone再补物理设备验证。

## 后续尚未实施的分析方向

正文搜索：旧48键入阶段预取全文后内存查询，不能恢复现有测试禁止的输入350ms自动读库。首次主要成本是完整来源快照、SHA/严格校验和worker复制；研究绑定数据库实例+revision+投影语义版本+当前授权的可失效完整已验证缓存，覆盖恢复/重连/数据库替换/设置变化及损坏回退。不能把SQLite LIKE/FTS未经语义证明替代JS匹配，亦不能复用只凭revision的旧库快照。

iOS PDF：旧公开单份约27.6s、批量64s、合成50s，原生写入≤135ms，热点是WebView RGBA PNG解压/去过滤/重编码。仅在证明alpha全255后研究保留PNG过滤残差的RGB变换；必须独立比对全部像素、5类过滤、透明拒绝、CRC/DEFLATE尾部、151页76输出、原8字体和布局，不降分辨率。计时诊断遇到transfer后buffer被detach，应在transfer前取头部诊断，不能关闭transfer冒充优化。

最近保存交互按上文新增要求实现与测试；全部阶段结束后双端全单元、全浏览器、全原生/大内容/容量/回滚/冷启动/系统UI/完整I/O/真实输入逐项通过，再正式构建、签名/完整摘要/交付。不因暂停保存而声称任务完成。

继续参考 `PERFORMANCE-RESUMED-20261023.md`（历史过程）、`COMPANY-HANDOFF-20261022.md`、`NEXT-SESSION.md`、`SAFETY-POLICY.md`、`SEARCH-RESUMED-20261023.md`。冲突以本次用户约束和本文件最新暂停状态为准。
