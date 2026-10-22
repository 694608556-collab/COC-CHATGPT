## 2026-10-23 最新：APK55 / IPA53 验收完成并交付

Android应用源码`49b184620a8361621c6e7defdf90a0efe0de4fc0`（`codex/ui-optimization-experiment`），iOS应用源码`6468332f5acebfa122662bdaf9208f4df051bfec`（`codex/ios-ipa-adaptation`）。共享搜索、导入提示、备份命名与无损PDF兼容修复已同步；原生平台差异保留。按用户决定，本轮Android使用本地完整测试及S9实机，不运行Android云端。

Android230单元、138完整浏览器、全部30项S9原生及完整I/O通过；iOS224单元、144完整浏览器、[完整CI39839362521](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39839362521)、3次冷启动、7项系统UI、容量/大库/事务回滚及完整I/O通过；同源码[独立原生联网回归39842251251](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39842251251)通过。共享512MiB正文Excel及单场70MiB完整处理链、Android70MiB/96MiB堆严格解析与1000组语法对照通过。没有删、跳过或降低失败用例。

S9公开78场约22.26MB：首次正文搜索3.272秒，后续0.240/0.287秒；同机旧APK51源码对照3.315/0.393/0.422秒。约683KB角色卡完整草稿1.484–1.577秒。首次仍有完整来源读取及校验，不能宣称所有首次搜索瞬时完成。双端46项完整计时见新版本目录TIMINGS.md；每端31份输出及78场完整原始正文均独立核对。iOS为云端模拟器，不是iPhone实测。

APK55本地用原证书构建签名，已从54覆盖安装S9，未打开正式应用，安装字节摘要一致，数据目录及首次安装时间保持；IPA53为上述完整成功任务的原始arm64未签名包，已保存本机。包名coc.logbook、版本1.0.8、构建号55/53、7份网页/Worker、8份原字体、完整SHA及无签名材料核对通过。APK SHA-256 `c13f224c3d767fa74ab1f3133723df9a9e10edb58cd67f531c0ff098d15e0f20`；IPA SHA-256 `4aeff5042057b05936f0d3ef588ae0bc10accdc605a0e2d2e682b3940fd00cec`。

本地最新目录`E:\COClogbook\local-delivery-explicit-search-20261023`。已将8份旧安装包、2份旧安装包归档和6份配套文件移入回收站；历史包本地删除不提交到GitHub。原工作区、`refs/backups/home-handoff-20261019`及用户既有历史删除状态保留。不得恢复单场64MiB或其他固定内容配额；完整正文/格式/关联/授权/CAS/回滚/自动备份保持，Android手势关闭与iOS外部目录暂缓决定不变。

接续优先在iPhone安装此IPA并验实际私人114场库、约700KB卡片及完整搜索/导入导出观感；设备数据与原始日志留本地。若继续追求首次搜索更快，沿完整来源生成、首次验证及安全可失效缓存预热分析，不能用截断、漏检、旧缓存或取消完整性校验提速。下方为分阶段历史证据，进行中及旧版本信息不代表当前交付状态。

# 2026-10-23 恢复优化：搜索复用、完整正文与公开 I/O 计时

用户已恢复开发。本文件覆盖此前暂停快照中的进行中状态；不把局部测试通过写成完整 CI 成功，也不把隔离调试应用/云端模拟器当作生产应用或 iPhone 实测。

Android 最新源码 `c75151880914676b2d2a64b50598f9bdbdc339ba`，远端 `codex/ui-optimization-experiment`。用户明确改用本地/S9完整验收，Android云端39827854926已取消，不计为完整成功；后续Android提交本轮不自动触发CI。下方搜索计时对应此前共享源码3261f54，最终原生修复正在S9重新全测。iOS 应用源码 `de90130abffcc067d9e137b7339b16aaff50667e`，远端 `codex/ios-ipa-adaptation`，完整任务 [39827874648](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39827874648)。记录时iOS云端仍运行；APK55/IPA53均未最终交付。

## 搜索变化和完整性边界

双方共享搜索复用、严格流式 JSON 优化和 Worker 复用已经同步。原生设备可用资源只决定是否使用完整快速读取/内存消息投影；不足时继续完整逐场/磁盘路径，不拒绝更大正文，不恢复任何固定容量配额。

普通数据复用旧版已验证有效的本地文件快速读取，随后仍检查严格 JSON（包括重复键及转义别名）、全部场次/正文结构、关联、完整长度/SHA、末次 revision 和租约清理。只读来源不能恢复/提交或发布。Android/iOS均删除搜索路径上重复的原生整份语义验证，由 Worker 对封存的只读来源执行完整语义检查；正式备份、恢复和提交的原生检查不变。

快速读取已对完整字节执行 SHA-256，解析器通过内部 WeakMap 注册的、私有且单次可用的输入凭证复用该证明，避免对同一份完整输入重复摘要。普通、包装或外部提供的流没有该凭证，仍逐字节完整计算；不能用输入参数中的布尔标记跳过检查。长度计数、严格 UTF-8/JSON、预算、EOF及取消不变。有效性能测试先观察同一907字节输入被重复摘要1814字节，再验证只摘要907字节；错误摘要、重复键、较大数据回退等既有用例保留并通过。

来源完整成功后缓存过滤后的消息投影。客户端只在全文验证、最后 revision 核对和原生清理全部成功后接纳缓存令牌；不同关键词复用同一份已验证投影，变更/过滤条件/范围/取消/损坏等不得返回过时结果。预热只编译计算代码，输入搜索框本身不读取正文或开始搜索。

## S9公开数据实测

仅操作隔离测试应用；生产应用未卸载、清空或降级。公开虚构库78场，每场650条消息，总正文库约22.26MB。所有对照使用同一台三星S9、同一公开夹具；数字不代表用户私人114场库或iPhone耗时。

|阶段|首次搜索|第二关键词|第三关键词|
|---|---:|---:|---:|
|旧APK51准确源码重建隔离调试版|3.315秒|0.393秒|0.422秒|
|本轮优化前重新读取路径|16.735秒|16.270秒|16.252秒|
|暂停前只加复用|14.665秒|0.305秒|0.330秒|
|恢复快速读取、完整验证和输入扫描优化|4.418秒|0.233秒|0.292秒|
|共享源码3261f54完整I/O矩阵|3.472秒|0.276秒|0.395秒|
|Android c751518全部30项原生轮次|3.138秒|0.266秒|0.289秒|

定稿前独立短轮首次3.610秒、随后0.285/0.277秒。首次已接近历史3.315秒，不能称为所有首次搜索都瞬间完成；同一已验证库的后续不同关键词恢复快速复用。

完整矩阵通过：独立回读31份输出的长度/摘要，原78场完整原始正文逐项相等。下表列出全部46项应用端到端计时。文件/目录人工选择的停留不计入；真实Worker、SQLite、原生复制与完整回读均计入。七版XLSX角色卡682849字节；表格114个链接加1个手动行，共115行。旧BIFF角色卡XLS是明确拒绝且不写库的用例，不能当成功导入。带delayed-stage的取消用例故意注入1.5秒延迟，不属于正常导入耗时。

|操作标识（与公开测试一致，S9源码c751518完整30项轮次）|秒|
|---|---:|
| module-search-0 | 3.138 |
| module-search-1 | 0.266 |
| module-search-2 | 0.289 |
| character-import-back-cancel-with-delayed-stage | 2.931 |
| character-import-xlsx-0 | 1.586 |
| character-import-xlsx-1 | 1.530 |
| character-import-xlsx-2 | 1.532 |
| character-import-xls-explicit-rejection-0 | 0.711 |
| character-import-xls-explicit-rejection-1 | 0.687 |
| character-import-xls-explicit-rejection-2 | 0.755 |
| record-table-import-preview-csv | 1.455 |
| record-table-import-commit-csv | 0.412 |
| record-table-import-preview-xlsx | 1.666 |
| record-table-import-commit-xlsx | 0.478 |
| record-table-import-preview-xls | 1.503 |
| record-table-import-commit-xls | 0.366 |
| record-table-export-csv | 0.343 |
| record-table-export-xlsx | 0.311 |
| blank-template-csv | 0.129 |
| blank-template-xlsx | 0.125 |
| backup-export-json | 4.855 |
| backup-export-zip-with-attachments | 22.055 |
| backup-import-preview-json | 21.986 |
| backup-import-commit-json | 9.276 |
| backup-import-preview-zip | 39.939 |
| backup-import-commit-zip | 9.422 |
| automatic-backup-json | 5.335 |
| reader-submitted-search | 0.355 |
| single-export-原始 JSON | 0.946 |
| single-export-TXT | 0.361 |
| single-export-带图 DOC | 0.388 |
| single-export-纯对话 DOC | 0.356 |
| single-export-DOCX | 0.706 |
| single-export-PDF | 1.549 |
| batch-export-原始 JSON | 1.001 |
| batch-export-TXT | 0.763 |
| batch-export-带图 DOC | 0.958 |
| batch-export-纯对话 DOC | 0.735 |
| batch-export-DOCX | 0.975 |
| batch-export-PDF | 2.708 |
| combined-export-原始 JSON | 1.288 |
| combined-export-TXT | 0.732 |
| combined-export-带图 DOC | 0.707 |
| combined-export-纯对话 DOC | 0.701 |
| combined-export-DOCX | 0.657 |
| combined-export-PDF | 2.110 |

## 验证进度和交付条件

定稿后类型检查和全量单元：Android226项、iOS220项全部通过。宿主原生完整检查通过，包括16项空间检查、133项备份流检查、完整68MiB单场、失败回滚、只读租约及严格JSON分配检查；宿主不能代替Android SQLite实机/模拟器或iOS原生结果。完整Edge浏览器Android137/iOS142均已通过。

Android按用户新决定以本地完整测试和S9全部30项原生测试验收；iOS完整源码CI仍须刷新，包含系统Files UI和完整I/O矩阵。既有失败记录保留，不删用例、不跳过、不降低断言。全部本地/S9及iOS云端验收通过后，才本地生成APK55、从对应iOS完整成功任务取IPA53，原证书签APK、核验arm64未签名IPA、7份网页/Worker、8份字体及完整摘要；两份新包都核验完毕后才清理旧本地安装包。

用户确认的主动提交搜索图标、非阻塞单一导入进度、移除独立取消导入按钮、按日期/应用名/日序号命名JSON/ZIP备份均保留。完整正文、格式、关联、即时授权、CAS、事务回滚与自动备份保留；Android手势关闭、iOS外部目录问题暂缓不变。

私人输入、原始日志、手机标识及签名材料留在本机，不随文档上传。本文件仅包含公开虚构夹具产生的汇总计时。保护引用 `refs/backups/home-handoff-20261019` 及用户有意删除的历史包状态保持。

## S9全套原生测试追加发现与修复

首轮30项中单场68MiB失败，栈明确在Android9的JsonReader.skipValue/nextString构造巨型StringBuilder，试图分配189005832字节并超过普通256MiB堆；96/192/512MiB大库、96MiB真实WebView搜索、50001行表格等其余用例通过。未改测试或容量标准。

最新Android使用SnapshotJson有界严格游标：忽略的正文字符串逐段验证而不保留其文字，只保留实体标识用于完整关联检查；重复键（含转义别名）、完整JSON语法、EOF及关联继续检查。桥接JSON语法验证也使用同一游标，避免另一处相同skipValue分配。新增宿主完整70MiB字符串/跨段转义/坏格式/重复键/关联回归在96MiB堆通过。S9原失败单场68MiB完整保存/重开/备份往返/空间与SQL回滚用例复测通过（51.662秒），整套30项正重新执行。该Java读取器缺陷只适用于Android平台，不将其无关实现拷贝到Swift；共享搜索实现仍一致。

## 追加PDF门禁缺陷与有效验证

iOS首轮完整I/O在“返回取消”使用了Android页头按钮选择器，已改用iOS受保护返回入口，并增加无页头按钮的真实边缘手势浏览器回归；继续要求进度结束、原生暂存释放及revision不变。随后完整I/O在第一份PDF发现实际WebKit原生PNG为8位RGBA（1754×1240、compression/filter/interlace均0），旧解析器仅接RGB，故正确拒绝保存不兼容页面；原失败证据保留。

候选不重采样、不忽略透明像素：RGB仍复用原压缩字节；RGBA完整校验PNG CRC、还原全部五种行过滤，逐像素证明Alpha255后无损保留RGB并压缩。运算转入原导出Worker，抽取原RPC运输模块避免引入整份Snapshot算法；导出Worker由945110字节增至948575字节，而非临时方案的1319292字节。根网页/Worker数量仍为7，字体仍8份。

新有效单元先因拒绝合法RGBA而失败，再验证完整像素一致、非不透明拒绝、原RGB压缩字节不变、CRC损坏及截断拒绝。新增真实浏览器将三页原画布编码为RGBA，通过实际Worker生成PDF，再独立解压每页并比较全部RGB像素SHA；全部一致。既有151页/24MiB文件预算、76个批量文件、合成超过150页、陈旧版本、取消不发布、500ms响应性标准均保留；PDF和取消针对性9项通过，双端完整单元230/224通过，Android138完整浏览器通过。iOS144完整浏览器及最新源码全套原生/I/O仍需刷新，不能宣称新包已交付。
